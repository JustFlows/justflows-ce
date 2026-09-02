import nodemailer from "nodemailer";
import { createHash, randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import { getGeneralSettings } from "./general-settings.js";
import {
  buildTransportOptions,
  DEFAULT_MAIL_CONFIG,
  formatFromHeader,
  isMailTransport,
  isSmtpSecure,
  wrapMailHtml,
  type MailConfig,
  type MailTransport,
  type SmtpSecure,
} from "./mail-config.js";
import { getSiteId, getSiteSetting, setSiteSetting } from "./site-settings.js";
import { decryptSecret, encryptSecret } from "./secret-box.js";
import { getRegisteredMailTransport, listRegisteredMailTransports } from "./mail-transports.js";
import { sanitizeHtmlBlock, sanitizePlainText } from "@justflows/blocks";
import { currentRequestId } from "./diagnostics.js";
import type { EmailDeliveryContext, EmailDeliveryEvent, EmailSender } from "@justflows/sdk";

let activeDeliveries = 0;
const recentDeliveries: number[] = [];

async function withDeliverySlot<T>(config: MailConfig, send: () => Promise<T>): Promise<T> {
  const cutoff = Date.now() - 60_000;
  while (recentDeliveries.length && recentDeliveries[0]! < cutoff) recentDeliveries.shift();
  if (recentDeliveries.length >= config.rateLimitPerMinute)
    throw new Error("Mail rate limit temporarily exceeded");
  if (activeDeliveries >= config.concurrency)
    throw new Error("Mail concurrency limit temporarily exceeded");
  activeDeliveries++;
  recentDeliveries.push(Date.now());
  try {
    return await send();
  } finally {
    activeDeliveries--;
  }
}

export type { MailConfig, MailTransport, SmtpSecure };

export interface PublicMailSettings {
  transport: MailTransport;
  fromName: string;
  fromAddress: string;
  replyTo: string;
  envelopeSender: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: SmtpSecure;
  smtpUser: string;
  smtpPassSet: boolean;
  rateLimitPerMinute: number;
  concurrency: number;
  transports: Array<{ id: string; label: string }>;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  /** Template-only identity overrides, validated by the template service. */
  fromName?: string;
  disableReplyTo?: boolean;
  /** Stable identity attached by sendTemplateMail; callers should not forge these fields. */
  templateKey?: string;
  templateVersion?: number;
  locale?: string;
  type?: string;
  transactional?: boolean;
  /** Internal retry counter; callers should omit it. */
  retryAttempt?: number;
}

export type MailResult =
  | { ok: true; response: string; messageId?: string; logId?: string }
  | { ok: false; error: string; logId?: string };

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

async function siteName(): Promise<string> {
  try {
    const db = await getDb();
    const rows = await db.query<{ name: string }>("SELECT name FROM sites LIMIT 1");
    return rows[0]?.name?.trim() || "Justflows";
  } catch {
    return "Justflows";
  }
}

function envFallback(): Partial<MailConfig> {
  const out: Partial<MailConfig> = {};
  const transport = process.env.MAIL_TRANSPORT;
  if (transport && isMailTransport(transport)) out.transport = transport;
  if (process.env.SMTP_HOST) out.smtpHost = process.env.SMTP_HOST;
  if (process.env.SMTP_PORT && Number.isFinite(Number(process.env.SMTP_PORT))) {
    out.smtpPort = Number(process.env.SMTP_PORT);
  }
  const secure = process.env.SMTP_SECURE;
  if (secure && isSmtpSecure(secure)) out.smtpSecure = secure;
  if (process.env.SMTP_USER) out.smtpUser = process.env.SMTP_USER;
  if (process.env.SMTP_PASS) out.smtpPass = process.env.SMTP_PASS;
  return out;
}

export async function getMailConfig(siteId?: string | null): Promise<MailConfig> {
  const id = siteId ?? (await getSiteId());
  const env = envFallback();
  const stored = id ? await getSiteSetting<Partial<MailConfig>>(id, "mail") : null;
  const raw = stored && typeof stored === "object" ? stored : {};

  const transportRaw = asString(raw.transport ?? env.transport, DEFAULT_MAIL_CONFIG.transport);
  const secureRaw = asString(raw.smtpSecure ?? env.smtpSecure, DEFAULT_MAIL_CONFIG.smtpSecure);

  return {
    transport: isMailTransport(transportRaw) ? transportRaw : DEFAULT_MAIL_CONFIG.transport,
    fromName: asString(raw.fromName, DEFAULT_MAIL_CONFIG.fromName),
    fromAddress: asString(raw.fromAddress, DEFAULT_MAIL_CONFIG.fromAddress),
    replyTo: asString(raw.replyTo, DEFAULT_MAIL_CONFIG.replyTo),
    envelopeSender: asString(raw.envelopeSender, DEFAULT_MAIL_CONFIG.envelopeSender),
    smtpHost: asString(raw.smtpHost ?? env.smtpHost, DEFAULT_MAIL_CONFIG.smtpHost),
    smtpPort: asInt(raw.smtpPort ?? env.smtpPort, DEFAULT_MAIL_CONFIG.smtpPort),
    smtpSecure: isSmtpSecure(secureRaw) ? secureRaw : DEFAULT_MAIL_CONFIG.smtpSecure,
    smtpUser: asString(raw.smtpUser ?? env.smtpUser, DEFAULT_MAIL_CONFIG.smtpUser),
    // Stored encrypted since 0.1.2; decryptSecret passes plaintext through so
    // configs written by an older release keep working until the next save.
    smtpPass: raw.smtpPass
      ? decryptSecret(raw.smtpPass)
      : asString(env.smtpPass, DEFAULT_MAIL_CONFIG.smtpPass),
    rateLimitPerMinute: Math.max(
      1,
      asInt(raw.rateLimitPerMinute, DEFAULT_MAIL_CONFIG.rateLimitPerMinute),
    ),
    concurrency: Math.max(1, asInt(raw.concurrency, DEFAULT_MAIL_CONFIG.concurrency)),
  };
}

export function toPublicMailSettings(config: MailConfig): PublicMailSettings {
  return {
    transport: config.transport,
    fromName: config.fromName,
    fromAddress: config.fromAddress,
    replyTo: config.replyTo,
    envelopeSender: config.envelopeSender,
    smtpHost: config.smtpHost,
    smtpPort: config.smtpPort,
    smtpSecure: config.smtpSecure,
    smtpUser: config.smtpUser,
    smtpPassSet: Boolean(config.smtpPass),
    rateLimitPerMinute: config.rateLimitPerMinute,
    concurrency: config.concurrency,
    transports: [
      { id: "sendmail", label: "Sendmail (local)" },
      { id: "smtp", label: "SMTP" },
      ...listRegisteredMailTransports(),
    ],
  };
}

export async function saveMailConfig(
  siteId: string,
  patch: Partial<MailConfig> & { smtpPass?: string },
): Promise<void> {
  const current = await getMailConfig(siteId);
  const next: MailConfig = {
    ...current,
    ...patch,
    smtpPass:
      patch.smtpPass === undefined || patch.smtpPass === "" ? current.smtpPass : patch.smtpPass,
  };
  await setSiteSetting(siteId, "mail", {
    ...next,
    smtpPass: next.smtpPass ? encryptSecret(next.smtpPass) : "",
  });
}

async function fromHeader(config: MailConfig, nameOverride?: string): Promise<string | null> {
  const general = await getGeneralSettings();
  const address = config.fromAddress.trim() || general.adminEmail;
  if (!address) return null;
  const name = nameOverride?.trim() || config.fromName.trim() || (await siteName());
  return formatFromHeader(name, address);
}

function recipientHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

function maskRecipient(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

function redactMailDetail(value: string, config?: MailConfig): string {
  let safe = value.replace(/\r|\n/g, " ");
  for (const secret of [config?.smtpPass, config?.smtpUser]) {
    if (secret && secret.length >= 3) safe = safe.replaceAll(secret, "[redacted]");
  }
  return safe.slice(0, 4_000);
}

async function createDeliveryLog(
  siteId: string,
  message: MailMessage,
  transport: string,
): Promise<string | undefined> {
  try {
    const id = randomUUID();
    const now = new Date().toISOString();
    await (
      await getDb()
    ).run(
      `INSERT INTO email_deliveries (id, site_id, message_type, recipient_masked, recipient_hash, recipient_encrypted, message_encrypted, subject, status, transport, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        siteId,
        message.type ?? "transactional",
        maskRecipient(message.to),
        recipientHash(message.to),
        encryptSecret(message.to.trim()),
        encryptSecret(JSON.stringify(message)),
        message.subject,
        "queued",
        transport,
        0,
        now,
        now,
      ],
    );
    return id;
  } catch {
    return undefined;
  }
}

async function updateDeliveryLog(
  id: string | undefined,
  status: string,
  detail: { response?: string; error?: string; nextAttemptAt?: string } = {},
): Promise<void> {
  if (!id) return;
  try {
    const now = new Date().toISOString();
    await (
      await getDb()
    ).run(
      `UPDATE email_deliveries SET status = ?, attempts = attempts + 1, provider_response = ?, error_detail = ?, updated_at = ?, sent_at = ?, next_attempt_at = ? WHERE id = ?`,
      [
        status,
        detail.response ?? null,
        detail.error ?? null,
        now,
        status === "sent" ? now : null,
        detail.nextAttemptAt ?? null,
        id,
      ],
    );
  } catch {
    /* Logging must never turn a successful delivery into a failure. */
  }
}

async function isSuppressed(siteId: string, message: MailMessage): Promise<boolean> {
  if (message.transactional !== false) return false;
  const rows = await (
    await getDb()
  ).query<{ id: string }>(
    `SELECT id FROM email_suppressions WHERE site_id = ? AND email_hash = ? AND (message_type = ? OR message_type = '*') LIMIT 1`,
    [siteId, recipientHash(message.to), message.type ?? "non-transactional"],
  );
  return rows.length > 0;
}

function validateFilteredHeader(value: string | undefined, label: string, max = 500): void {
  if (value === undefined) return;
  if (!value.trim() || value.length > max || /[\r\n\0]/.test(value)) {
    throw new Error(`Email ${label} filter returned an invalid value`);
  }
}

async function mailHooks() {
  try {
    return (await import("./plugin-runtime.js")).getRuntimeHooks();
  } catch {
    return null;
  }
}

async function dispatchMailAction(
  hook: "email.queued" | "email.sent" | "email.failed",
  event: EmailDeliveryEvent,
  siteId: string,
): Promise<void> {
  const hooks = await mailHooks();
  if (!hooks) return;
  await hooks.dispatchAction(hook, event, {
    siteId,
    requestId: event.correlationId,
    source: "system",
  });
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const to = message.to.trim();
  if (!to || !to.includes("@")) {
    return { ok: false, error: "No recipient address" };
  }

  let logId: string | undefined;
  let config: MailConfig | undefined;
  let siteId: string | null = null;
  let deliveryContext: EmailDeliveryContext | null = null;
  const attempt = (message.retryAttempt ?? 0) + 1;
  try {
    siteId = await getSiteId();
    if (!siteId) return { ok: false, error: "No site found" };
    if (await isSuppressed(siteId, message))
      return { ok: false, error: "Recipient is suppressed for this email type" };
    config = await getMailConfig(siteId);
    const from = await fromHeader(config, message.fromName);
    if (!from) {
      const error = "Set an administration email address first";
      return { ok: false, error, logId };
    }

    const name = await siteName();
    deliveryContext = {
      templateKey: message.templateKey,
      templateVersion: message.templateVersion,
      locale: message.locale,
      messageType: message.type ?? "transactional",
      recipient: to,
      transport: config.transport,
      correlationId: currentRequestId() ?? undefined,
    };
    const hooks = await mailHooks();
    if (hooks) {
      await hooks.dispatchGate("email.beforeSend", deliveryContext, {
        siteId,
        requestId: deliveryContext.correlationId,
        source: "system",
      });
    }

    let sender: EmailSender = {
      from,
      replyTo: message.disableReplyTo ? undefined : (message.replyTo ?? (config.replyTo || undefined)),
      envelopeSender: config.envelopeSender || undefined,
    };
    let subject = message.subject;
    let text = message.text;
    let html = message.html ?? wrapMailHtml(message.text, `Sent by ${name}`);
    if (hooks) {
      sender = await hooks.applyFilter("email.sender", sender, deliveryContext, { siteId, requestId: deliveryContext.correlationId, source: "system" });
      subject = await hooks.applyFilter("email.subject", subject, deliveryContext, { siteId, requestId: deliveryContext.correlationId, source: "system" });
      const filteredHtml = await hooks.applyFilter("email.html", html, deliveryContext, { siteId, requestId: deliveryContext.correlationId, source: "system" });
      const filteredText = await hooks.applyFilter("email.text", text, deliveryContext, { siteId, requestId: deliveryContext.correlationId, source: "system" });
      if (filteredHtml !== html) html = sanitizeHtmlBlock(filteredHtml);
      if (filteredText !== text) text = sanitizePlainText(filteredText);
    }
    validateFilteredHeader(sender.from, "sender", 500);
    if (!sender.from.includes("@")) throw new Error("Email sender filter returned an invalid address");
    validateFilteredHeader(sender.replyTo, "reply-to", 320);
    validateFilteredHeader(sender.envelopeSender, "envelope sender", 320);
    validateFilteredHeader(subject, "subject", 500);
    if (html.length > 200_000 || text.length > 100_000) throw new Error("Filtered email content is too large");

    const filteredMessage: MailMessage = { ...message, subject, html, text };
    logId = await createDeliveryLog(siteId, filteredMessage, config.transport);
    deliveryContext = { ...deliveryContext, deliveryId: logId };
    await dispatchMailAction("email.queued", { ...deliveryContext, status: "queued", attempt }, siteId);

    const outgoing = {
      from: sender.from,
      to,
      subject,
      text,
      html,
      replyTo: sender.replyTo,
      envelope: sender.envelopeSender ? { from: sender.envelopeSender, to: [to] } : undefined,
    };
    if (config.transport.startsWith("plugin:")) {
      const plugin = getRegisteredMailTransport(config.transport);
      if (!plugin) throw new Error(`Mail transport ${config.transport} is not available`);
      const envelopeSender = sender.envelopeSender;
      const result = await withDeliverySlot(config, () =>
        plugin.send({ ...outgoing, envelopeSender }),
      );
      const status = result.status ?? "sent";
      await updateDeliveryLog(logId, status, { response: result.response });
      if (status === "deferred") throw new Error(result.response);
      if (status !== "sent") {
        await dispatchMailAction("email.failed", { ...deliveryContext, status, attempt, detail: redactMailDetail(result.response, config) }, siteId);
        return { ok: false, error: result.response, logId };
      }
      await dispatchMailAction("email.sent", { ...deliveryContext, status: "sent", attempt, detail: redactMailDetail(result.response, config) }, siteId);
      return { ok: true, response: result.response, messageId: result.messageId, logId };
    }
    const transporter = nodemailer.createTransport(
      buildTransportOptions(config) as Parameters<typeof nodemailer.createTransport>[0],
    );
    const result = await withDeliverySlot(config, () => transporter.sendMail(outgoing));
    const response = String(result.response ?? result.messageId ?? "Accepted");
    await updateDeliveryLog(logId, "sent", { response });
    await dispatchMailAction("email.sent", { ...deliveryContext, status: "sent", attempt, detail: redactMailDetail(response, config) }, siteId);
    return { ok: true, response, messageId: result.messageId, logId };
  } catch (err) {
    const detail = redactMailDetail(err instanceof Error ? err.message : String(err), config);
    console.error("Mail send failed:", detail);
    const transient = /timeout|temporar|rate|4\d\d|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(detail);
    if (transient && attempt <= 3) {
      const delay = [60_000, 300_000, 900_000][attempt - 1]!;
      await updateDeliveryLog(logId, "deferred", {
        error: detail,
        nextAttemptAt: new Date(Date.now() + delay).toISOString(),
      });
      const { getPluginJobScheduler } = await import("./plugin-jobs.js");
      const scheduler = getPluginJobScheduler();
      const jobName = `mail:retry:${logId ?? randomUUID()}`;
      scheduler.register({
        name: jobName,
        maxAttempts: 1,
        handler: async () => {
          const result = await sendMail({ ...message, retryAttempt: attempt });
          if (!result.ok) throw new Error(result.error);
          scheduler.unregister(jobName);
          return { success: true, message: result.response };
        },
      });
      scheduler.enqueue(jobName, delay);
      if (siteId && deliveryContext) await dispatchMailAction("email.failed", { ...deliveryContext, status: "deferred", attempt, detail }, siteId);
    } else {
      await updateDeliveryLog(logId, "failed", { error: detail });
      if (siteId && deliveryContext) await dispatchMailAction("email.failed", { ...deliveryContext, status: "failed", attempt, detail }, siteId);
    }
    return { ok: false, error: detail, logId };
  }
}

/** Render and send a registered system template, with a built-in fallback on invalid customization. */
export async function sendTemplateMail(input: {
  to: string;
  key: string;
  values: Record<string, string>;
  locale?: string;
  replyTo?: string;
}): Promise<MailResult> {
  const siteId = await getSiteId();
  if (!siteId) return { ok: false, error: "No site found" };
  const general = await getGeneralSettings();
  const { renderEmailTemplate } = await import("./email-templates.js");
  const rendered = await renderEmailTemplate({
    siteId,
    key: input.key,
    locale: input.locale,
    values: {
      site_name: await siteName(),
      support_email: general.adminEmail,
      ...input.values,
    },
    mode: "published",
  });
  if (!rendered.enabled) return { ok: false, error: "This email template is disabled" };
  return sendMail({
    to: input.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    replyTo: input.replyTo,
    fromName: rendered.senderName || undefined,
    disableReplyTo: rendered.replyToPolicy === "none",
    type: `${input.key}@${rendered.version}`,
    templateKey: input.key,
    templateVersion: rendered.version,
    locale: rendered.locale,
  });
}

/** Fire-and-forget admin notification. Failures are logged, never thrown. */
export async function notifyAdmin(
  subject: string,
  text: string,
  replyTo?: string,
): Promise<MailResult> {
  const general = await getGeneralSettings();
  if (!general.adminEmail) {
    return { ok: false, error: "No administration email address" };
  }
  return sendMail({ to: general.adminEmail, subject, text, replyTo });
}

export async function sendTestMail(): Promise<MailResult> {
  const general = await getGeneralSettings();
  const name = await siteName();
  return sendMail({
    to: general.adminEmail,
    subject: `[${name}] Test email`,
    text: `This is a test email from ${name}. If you received it, outgoing mail is working.`,
    type: "test",
  });
}

export interface EmailDeliveryRow {
  id: string;
  message_type: string;
  recipient_masked: string;
  subject: string;
  status: string;
  transport: string;
  attempts: number;
  provider_response: string | null;
  error_detail: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  next_attempt_at: string | null;
}

export async function listEmailDeliveries(
  siteId: string,
  status?: string,
): Promise<EmailDeliveryRow[]> {
  const params: string[] = [siteId];
  const where = status ? " AND status = ?" : "";
  if (status) params.push(status);
  return (await getDb()).query<EmailDeliveryRow>(
    `SELECT id, message_type, recipient_masked, subject, status, transport, attempts, provider_response, error_detail, created_at, updated_at, sent_at, next_attempt_at
     FROM email_deliveries WHERE site_id = ?${where} ORDER BY created_at DESC LIMIT 200`,
    params,
  );
}

export async function retryEmailDelivery(siteId: string, id: string): Promise<MailResult> {
  const rows = await (
    await getDb()
  ).query<{ message_encrypted: string }>(
    "SELECT message_encrypted FROM email_deliveries WHERE id = ? AND site_id = ? LIMIT 1",
    [id, siteId],
  );
  if (!rows[0]) return { ok: false, error: "Email delivery not found" };
  const message = JSON.parse(decryptSecret(rows[0].message_encrypted)) as MailMessage;
  return sendMail(message);
}

export async function addEmailSuppression(
  siteId: string,
  email: string,
  messageType: string,
  reason = "Unsubscribed",
): Promise<void> {
  const db = await getDb();
  const hash = recipientHash(email);
  const existing = await db.query<{ id: string }>(
    "SELECT id FROM email_suppressions WHERE site_id = ? AND email_hash = ? AND message_type = ? LIMIT 1",
    [siteId, hash, messageType],
  );
  if (existing.length) return;
  await db.run(
    "INSERT INTO email_suppressions (id, site_id, email_hash, email_masked, message_type, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      randomUUID(),
      siteId,
      hash,
      maskRecipient(email),
      messageType,
      reason,
      new Date().toISOString(),
    ],
  );
}

export async function listEmailSuppressions(
  siteId: string,
): Promise<
  Array<{
    id: string;
    email_masked: string;
    message_type: string;
    reason: string | null;
    created_at: string;
  }>
> {
  return (await getDb()).query(
    "SELECT id, email_masked, message_type, reason, created_at FROM email_suppressions WHERE site_id = ? ORDER BY created_at DESC LIMIT 200",
    [siteId],
  );
}

export async function removeEmailSuppression(siteId: string, id: string): Promise<void> {
  await (
    await getDb()
  ).run("DELETE FROM email_suppressions WHERE id = ? AND site_id = ?", [id, siteId]);
}
