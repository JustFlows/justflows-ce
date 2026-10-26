// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import type { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { registerCoreJob } from "../jobs/core-jobs.js";
import { getControlDb } from "../database/db.js";
import { acceptInboundMessage, getMailConfig, siteMailScope } from "./mail.js";
import {
  chooseInboundSite,
  imapMailboxName,
  normalizeMailAddress,
  rememberMessage,
  remembersMessage,
  shouldPollMailbox,
  type InboundSiteAddress,
} from "./inbound-route.js";
import type { MailConfig } from "./mail-config.js";

const SEEN_KEY = "mail_inbound_seen";
const BATCH = 10;

/** Start the mailbox reader. A site without incoming mail settings is skipped. */
export function startInboundMailJob(): void {
  registerCoreJob(
    { name: "mail.inbound", schedule: "*/2 * * * *", handler: runInboundPoll },
    { runAfterMs: 30_000 },
  );
}

async function runInboundPoll(): Promise<{ success: boolean; message: string }> {
  const read = await pollInboundMail();
  return { success: true, message: `Read ${read} message${read === 1 ? "" : "s"}` };
}

/** Read every mailbox this installation is allowed to open. */
export async function pollInboundMail(): Promise<number> {
  const sites = await activeSiteIds();
  if (sites.length === 0) return 0;
  const addresses = await siteAddresses(sites);
  let read = 0;
  for (const siteId of sites) {
    try {
      const { runWithSiteDatabase } = await import("../tenancy/provision.js");
      const opened = await runWithSiteDatabase(siteId, async () => {
        const scope = await siteMailScope(siteId);
        const config = await getMailConfig(siteId);
        if (!shouldPollMailbox(scope, config)) return 0;
        return readMailbox(siteId, config, addresses);
      });
      read += opened;
    } catch (error) {
      console.error(
        "Inbound mail mailbox failed:",
        JSON.stringify({ siteId, message: errorText(error) }),
      );
    }
  }
  return read;
}

async function readMailbox(siteId: string, config: MailConfig, sites: InboundSiteAddress[]): Promise<number> {
  await assertImapDestination(siteId, config);
  const { ImapFlow } = await import("imapflow");
  const secure = config.imapSecure === "ssl";
  const client = new ImapFlow({
    host: (config.imapHost ?? "").trim(),
    port: config.imapPort || 993,
    secure,
    doSTARTTLS: config.imapSecure === "starttls",
    auth: { user: (config.imapUser ?? "").trim(), pass: config.imapPass ?? "" },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
  let read = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock(imapMailboxName(config.imapMailbox));
    try {
      const found = await client.search({ seen: false }, { uid: true });
      const uids = Array.isArray(found) ? found.slice(0, BATCH) : [];
      for (const uid of uids) {
        const filed = await fileUnseen(client, siteId, uid, sites);
        if (filed) read += 1;
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return read;
}

async function fileUnseen(
  client: ImapFlow,
  mailboxSiteId: string,
  uid: number,
  sites: InboundSiteAddress[],
): Promise<boolean> {
  const downloaded = await client.fetchOne(String(uid), { source: true, uid: true }, { uid: true });
  const source = downloaded && "source" in downloaded ? downloaded.source : undefined;
  if (!source || source.length > 1_000_000) {
    await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }).catch(() => undefined);
    return false;
  }
  const parsed = await simpleParser(source);
  const from = parsed.from?.value?.[0]?.address?.trim().toLowerCase() ?? "";
  const subject = (parsed.subject ?? "").replace(/[\r\n]/g, " ").trim().slice(0, 200);
  const text = (parsed.text ?? "").replace(/\0/g, "").slice(0, 20_000);
  if (!from.includes("@") || !text.trim()) {
    await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }).catch(() => undefined);
    return false;
  }
  const recipients = addressList(parsed.to).concat(addressList(parsed.cc));
  const key = messageKey(parsed.messageId ?? "", from, subject, text);
  const rootId = sites[0]?.id && (await rootSiteId()) || mailboxSiteId;
  const seen = await readSeen(rootId);
  if (remembersMessage(seen, key)) {
    await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }).catch(() => undefined);
    return false;
  }
  const claimed = await claimSite(sites, { from, to: recipients[0] ?? "", subject, text });
  const siteId = chooseInboundSite({
    mailboxSiteId,
    claimedSiteId: claimed,
    recipients,
    sites,
  });
  await withPluginSite(siteId, () =>
    acceptInboundMessage({ from, to: recipients.join(", "), subject, text, siteId }),
  );
  await writeSeen(rootId, rememberMessage(seen, key));
  await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }).catch(() => undefined);
  return true;
}

async function claimSite(
  sites: InboundSiteAddress[],
  message: { from: string; to: string; subject: string; text: string },
): Promise<string> {
  const { getRuntimeHooks } = await import("../plugins/plugin-runtime.js");
  const hooks = getRuntimeHooks();
  const claimed: string[] = [];
  for (const site of sites) {
    try {
      const siteId = await withPluginSite(site.id, () =>
        hooks.applyFilter("email.route", "", { ...message, siteId: site.id }, { siteId: site.id, source: "job" }),
      );
      if (siteId === site.id) claimed.push(site.id);
    } catch (error) {
      console.error(
        "Inbound mail route failed:",
        JSON.stringify({ siteId: site.id, message: errorText(error) }),
      );
    }
  }
  return claimed.length === 1 ? claimed[0]! : "";
}

/**
 * Plugin rows, the route filter, and filing all run as this site.
 * Helpdesk registers its mail handlers once, on the first site that activates it.
 * Row calls follow the tenant site, so a reply is written into that site's tickets.
 */
async function withPluginSite<T>(siteId: string, fn: () => Promise<T>): Promise<T> {
  const { runWithSiteDatabase } = await import("../tenancy/provision.js");
  const { runWithTenant } = await import("../tenancy/context.js");
  const { getControlDb, getDb } = await import("../database/db.js");
  const { installationRootSiteId } = await import("../tenancy/registry.js");
  return runWithSiteDatabase(siteId, async () => {
    const control = await getControlDb();
    const rows = await control.query<{ tenant_id: string; user_mode: string; database_mode: string; hostname: string | null }>(
      `SELECT s.tenant_id, t.user_mode, t.database_mode, d.hostname
       FROM sites s JOIN tenants t ON t.id = s.tenant_id
       LEFT JOIN site_domains d ON d.site_id = s.id AND d.is_primary = ?
       WHERE s.id = ? LIMIT 1`,
      [true, siteId],
    ).catch(() => []);
    const row = rows[0];
    const plugins = await (await getDb()).query<{ plugin_id: string }>(
      "SELECT plugin_id FROM plugins WHERE site_id = ? AND status = 'active'",
      [siteId],
    ).catch(() => null);
    const root = await installationRootSiteId().catch(() => null);
    return runWithTenant({
      tenantId: row ? String(row.tenant_id) : "",
      siteId,
      hostname: row?.hostname ? String(row.hostname) : "",
      userMode: row?.user_mode === "shared" ? "shared" : "isolated",
      databaseMode: row?.database_mode === "separate" ? "separate" : "current",
      rootSite: root === null || root === siteId,
      activePluginIds: plugins ? new Set(plugins.map((plugin) => String(plugin.plugin_id))) : null,
    }, fn);
  });
}

function addressList(value: { value?: Array<{ address?: string }> } | { value?: Array<{ address?: string }> }[] | undefined): string[] {
  if (!value) return [];
  const boxes = Array.isArray(value) ? value : [value];
  const found: string[] = [];
  for (const box of boxes) {
    for (const entry of box.value ?? []) {
      const address = normalizeMailAddress(entry.address ?? "");
      if (address.includes("@")) found.push(address);
    }
  }
  return found;
}

function messageKey(messageId: string, from: string, subject: string, text: string): string {
  const basis = messageId.trim() || `${from}\n${subject}\n${text.slice(0, 500)}`;
  return createHash("sha256").update(basis).digest("hex");
}

async function activeSiteIds(): Promise<string[]> {
  try {
    const rows = await (await getControlDb()).query<{ id: string }>(
      `SELECT s.id FROM sites s JOIN tenants t ON t.id = s.tenant_id
       WHERE s.status = 'active' AND t.status = 'active' ORDER BY s.created_at ASC, s.id ASC`,
    );
    return rows.map((row) => String(row.id));
  } catch {
    const { getSiteId } = await import("../settings/site-settings.js");
    const id = await getSiteId();
    return id ? [id] : [];
  }
}

async function rootSiteId(): Promise<string> {
  const { installationRootSiteId } = await import("../tenancy/registry.js");
  return (await installationRootSiteId().catch(() => null)) || (await activeSiteIds())[0] || "";
}

async function siteAddresses(siteIds: string[]): Promise<InboundSiteAddress[]> {
  const { getGeneralSettings } = await import("../settings/general-settings.js");
  const { runWithSiteDatabase } = await import("../tenancy/provision.js");
  const sites: InboundSiteAddress[] = [];
  for (const id of siteIds) {
    const addresses = await runWithSiteDatabase(id, async () => {
      const [general, mail] = await Promise.all([getGeneralSettings(id), getMailConfig(id)]);
      return [general.adminEmail, mail.replyTo, mail.fromAddress]
        .map(normalizeMailAddress)
        .filter((address) => address.includes("@"));
    }).catch(() => [] as string[]);
    sites.push({ id, addresses });
  }
  return sites;
}

async function readSeen(siteId: string): Promise<string[]> {
  if (!siteId) return [];
  const { getSiteSetting } = await import("../settings/site-settings.js");
  const { runWithSiteDatabase } = await import("../tenancy/provision.js");
  const stored = await runWithSiteDatabase(siteId, () => getSiteSetting<unknown>(siteId, SEEN_KEY));
  if (!Array.isArray(stored)) return [];
  return stored.filter((item): item is string => typeof item === "string" && /^[a-f0-9]{64}$/.test(item)).slice(-500);
}

async function writeSeen(siteId: string, seen: string[]): Promise<void> {
  if (!siteId) return;
  const { setSiteSetting } = await import("../settings/site-settings.js");
  const { runWithSiteDatabase } = await import("../tenancy/provision.js");
  await runWithSiteDatabase(siteId, () => setSiteSetting(siteId, SEEN_KEY, seen.slice(-500)));
}

async function assertImapDestination(siteId: string, config: MailConfig): Promise<void> {
  const host = (config.imapHost ?? "").trim();
  const port = config.imapPort || 993;
  const { isInstallationRootSite } = await import("../tenancy/registry.js");
  if (await isInstallationRootSite(siteId)) return;
  if (config.imapSecure === "none") throw new Error("IMAP must use STARTTLS or SSL");
  if (port !== 143 && port !== 993) throw new Error("IMAP port must be 143 or 993");
  const { isBlockedWebhookAddress, isLocalHostName } = await import("../security/webhook-url.js");
  if (isLocalHostName(host)) throw new Error("Private IMAP servers are not allowed");
  const { lookup } = await import("node:dns/promises");
  const { isIP } = await import("node:net");
  const answers = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (answers.length === 0 || answers.some(({ address }) => isBlockedWebhookAddress(address))) {
    throw new Error("Private IMAP servers are not allowed");
  }
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\r|\n/g, " ").slice(0, 200);
}
