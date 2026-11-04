// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import { getDb } from "../database/db.js";
import { sendMail } from "../email/mail.js";
import { getGeneralSettings } from "../settings/general-settings.js";
import { getSiteSetting, setSiteSetting } from "../settings/site-settings.js";
import type { AuditAction } from "./audit-log.js";

export interface SecurityNotificationSettings {
  enabled: boolean;
  networkEnabled?: boolean;
}

export interface SecurityNotificationStatus extends SecurityNotificationSettings {
  recipient: string;
  available: boolean;
  canManageNetwork: boolean;
  networkEnabled: boolean;
}

const SETTING_KEY = "security_notifications";
const HOURLY_LIMIT = 10;

export const NOTIFIABLE_SECURITY_ACTIONS = new Set<AuditAction>([
  "auth.login_failed",
  "auth.password_reset_failed",
  "auth.2fa_disabled",
  "user.role_changed",
  "user.access_changed",
  "access.role_created",
  "access.role_updated",
  "access.role_deleted",
  "apikey.created",
  "apikey.rotated",
  "apikey.revoked",
  "plugin.installed",
  "plugin.activated",
  "plugin.updated",
  "theme.installed",
  "theme.activated",
  "theme.updated",
  "core.updated",
  "core.auto_update_failed",
  "security.headers_changed",
  "security.admin_path_changed",
  "security.notifications_changed",
  "integrity.failed",
]);

function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "";
  return `${local.slice(0, 1)}***@${domain}`;
}

export async function getSecurityNotificationStatus(siteId: string): Promise<SecurityNotificationStatus> {
  const [stored, general] = await Promise.all([
    getSiteSetting<SecurityNotificationSettings>(siteId, SETTING_KEY),
    getGeneralSettings(siteId),
  ]);
  const { isInstallationRootSite } = await import("../tenancy/registry.js");
  const canManageNetwork = await isInstallationRootSite(siteId).catch(() => false);
  return {
    enabled: stored?.enabled === true,
    recipient: maskEmail(general.adminEmail),
    available: general.adminEmail.includes("@"),
    canManageNetwork,
    networkEnabled: canManageNetwork && stored?.networkEnabled === true,
  };
}

export async function setSecurityNotificationSettings(
  siteId: string,
  settings: SecurityNotificationSettings,
): Promise<SecurityNotificationStatus> {
  const current = await getSecurityNotificationStatus(siteId);
  if (settings.networkEnabled !== undefined && !current.canManageNetwork) {
    throw new Error("Only the installation site can manage network notifications");
  }
  await setSiteSetting(siteId, SETTING_KEY, {
    enabled: settings.enabled === true,
    networkEnabled: current.canManageNetwork && settings.networkEnabled === true,
  });
  return getSecurityNotificationStatus(siteId);
}

async function safeAdminUrl(siteId: string): Promise<string | null> {
  try {
    const rows = await (await getDb()).query<{ url: string }>(
      "SELECT url FROM sites WHERE id = ? LIMIT 1",
      [siteId],
    );
    const base = new URL(rows[0]?.url ?? "");
    if (base.protocol !== "https:" && base.protocol !== "http:") return null;
    return new URL("/admin/security/audit?view=security", base).toString();
  } catch {
    return null;
  }
}

async function claimEvent(siteId: string, eventId: string): Promise<string | null> {
  const claim = randomUUID();
  const metadata = JSON.stringify({ securityNotification: { claim, status: "claimed" } });
  const db = await getDb();
  await db.run(
    `UPDATE audit_log SET metadata = ?
     WHERE id = ? AND site_id = ? AND (metadata IS NULL OR metadata = '{}')`,
    [metadata, eventId, siteId],
  );
  const rows = await db.query<{ metadata: unknown }>(
    "SELECT metadata FROM audit_log WHERE id = ? AND site_id = ? LIMIT 1",
    [eventId, siteId],
  );
  const raw = rows[0]?.metadata;
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown> : raw as Record<string, unknown> | undefined;
  } catch {
    parsed = undefined;
  }
  const notification = parsed?.securityNotification as { claim?: string } | undefined;
  return notification?.claim === claim ? claim : null;
}

async function finishEvent(siteId: string, eventId: string, claim: string, status: string): Promise<void> {
  const metadata = JSON.stringify({ securityNotification: { claim, status } });
  await (await getDb()).run(
    "UPDATE audit_log SET metadata = ? WHERE id = ? AND site_id = ?",
    [metadata, eventId, siteId],
  );
}

async function deliveryBudgetRemaining(siteId: string): Promise<number> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const rows = await (await getDb()).query<{ total: unknown }>(
    "SELECT COUNT(*) AS total FROM email_deliveries WHERE site_id = ? AND message_type = ? AND created_at >= ?",
    [siteId, "security-event", cutoff],
  );
  return Math.max(0, HOURLY_LIMIT - Number(rows[0]?.total ?? 0));
}

/** Deliver one sanitized event summary after its audit row is durable. */
export async function notifySecurityEvent(input: {
  id: string;
  siteId: string;
  action: AuditAction;
  occurredAt: string;
}): Promise<void> {
  if (!NOTIFIABLE_SECURITY_ACTIONS.has(input.action)) return;
  const settings = await getSecurityNotificationStatus(input.siteId);
  const recipients = new Set<string>();
  if (settings.enabled && settings.available) {
    recipients.add((await getGeneralSettings(input.siteId)).adminEmail);
  }
  const { installationRootSiteId } = await import("../tenancy/registry.js");
  const rootId = await installationRootSiteId().catch(() => null);
  if (rootId && rootId !== input.siteId) {
    const { runWithSiteDatabase } = await import("../tenancy/provision.js");
    const network = await runWithSiteDatabase(rootId, async () => {
      const stored = await getSiteSetting<SecurityNotificationSettings>(rootId, SETTING_KEY);
      const general = await getGeneralSettings(rootId);
      return { enabled: stored?.networkEnabled === true, email: general.adminEmail };
    }).catch(() => ({ enabled: false, email: "" }));
    if (network.enabled && network.email.includes("@")) recipients.add(network.email);
  }
  if (recipients.size === 0) return;
  const claim = await claimEvent(input.siteId, input.id);
  if (!claim) return;
  const budget = await deliveryBudgetRemaining(input.siteId);
  if (budget < 1) {
    await finishEvent(input.siteId, input.id, claim, "rate_limited");
    return;
  }

  const link = await safeAdminUrl(input.siteId);
  const text = [
    `Security event: ${input.action}`,
    `Time: ${input.occurredAt}`,
    link ? `Review security events: ${link}` : "Review the Security Center in your Justflows administration.",
  ].join("\n\n");
  let delivered = true;
  for (const recipient of [...recipients].slice(0, budget)) {
    const result = await sendMail({
      to: recipient,
      subject: `[Justflows] Security event: ${input.action}`,
      text,
      type: "security-event",
    });
    delivered = delivered && result.ok;
  }
  await finishEvent(input.siteId, input.id, claim, delivered ? "sent" : "failed");
}
