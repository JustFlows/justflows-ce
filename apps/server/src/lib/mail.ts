import nodemailer from "nodemailer";
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

export type { MailConfig, MailTransport, SmtpSecure };

export interface PublicMailSettings {
  transport: MailTransport;
  fromName: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: SmtpSecure;
  smtpUser: string;
  smtpPassSet: boolean;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export type MailResult = { ok: true } | { ok: false; error: string };

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
  const stored = id
    ? await getSiteSetting<Partial<MailConfig>>(id, "mail")
    : null;
  const raw = stored && typeof stored === "object" ? stored : {};

  const transportRaw = asString(raw.transport ?? env.transport, DEFAULT_MAIL_CONFIG.transport);
  const secureRaw = asString(raw.smtpSecure ?? env.smtpSecure, DEFAULT_MAIL_CONFIG.smtpSecure);

  return {
    transport: isMailTransport(transportRaw) ? transportRaw : DEFAULT_MAIL_CONFIG.transport,
    fromName: asString(raw.fromName, DEFAULT_MAIL_CONFIG.fromName),
    smtpHost: asString(raw.smtpHost ?? env.smtpHost, DEFAULT_MAIL_CONFIG.smtpHost),
    smtpPort: asInt(raw.smtpPort ?? env.smtpPort, DEFAULT_MAIL_CONFIG.smtpPort),
    smtpSecure: isSmtpSecure(secureRaw) ? secureRaw : DEFAULT_MAIL_CONFIG.smtpSecure,
    smtpUser: asString(raw.smtpUser ?? env.smtpUser, DEFAULT_MAIL_CONFIG.smtpUser),
    smtpPass: asString(raw.smtpPass ?? env.smtpPass, DEFAULT_MAIL_CONFIG.smtpPass),
  };
}

export function toPublicMailSettings(config: MailConfig): PublicMailSettings {
  return {
    transport: config.transport,
    fromName: config.fromName,
    smtpHost: config.smtpHost,
    smtpPort: config.smtpPort,
    smtpSecure: config.smtpSecure,
    smtpUser: config.smtpUser,
    smtpPassSet: Boolean(config.smtpPass),
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
      patch.smtpPass === undefined || patch.smtpPass === ""
        ? current.smtpPass
        : patch.smtpPass,
  };
  await setSiteSetting(siteId, "mail", next);
}

async function fromHeader(config: MailConfig): Promise<string | null> {
  const general = await getGeneralSettings();
  if (!general.adminEmail) return null;
  const name = config.fromName.trim() || (await siteName());
  return formatFromHeader(name, general.adminEmail);
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const to = message.to.trim();
  if (!to || !to.includes("@")) {
    return { ok: false, error: "No recipient address" };
  }

  try {
    const config = await getMailConfig();
    const from = await fromHeader(config);
    if (!from) {
      return { ok: false, error: "Set an administration email address first" };
    }

    const transporter = nodemailer.createTransport(
      buildTransportOptions(config) as Parameters<typeof nodemailer.createTransport>[0],
    );
    const name = await siteName();
    await transporter.sendMail({
      from,
      to,
      subject: message.subject,
      text: message.text,
      html: message.html ?? wrapMailHtml(message.text, `Sent by ${name}`),
      replyTo: message.replyTo,
    });
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("Mail send failed:", detail);
    return { ok: false, error: detail };
  }
}

/** Fire-and-forget admin notification. Failures are logged, never thrown. */
export async function notifyAdmin(subject: string, text: string, replyTo?: string): Promise<MailResult> {
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
  });
}
