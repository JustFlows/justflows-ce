export const MAIL_TRANSPORTS = ["sendmail", "smtp"] as const;
export type MailTransport = (typeof MAIL_TRANSPORTS)[number] | `plugin:${string}`;

export const SMTP_SECURE_MODES = ["none", "starttls", "ssl"] as const;
export type SmtpSecure = (typeof SMTP_SECURE_MODES)[number];

export interface MailConfig {
  transport: MailTransport;
  fromName: string;
  fromAddress: string;
  replyTo: string;
  envelopeSender: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: SmtpSecure;
  smtpUser: string;
  smtpPass: string;
  rateLimitPerMinute: number;
  concurrency: number;
}

export const DEFAULT_MAIL_CONFIG: MailConfig = {
  transport: "sendmail",
  fromName: "",
  fromAddress: "",
  replyTo: "",
  envelopeSender: "",
  smtpHost: "localhost",
  smtpPort: 25,
  smtpSecure: "none",
  smtpUser: "",
  smtpPass: "",
  rateLimitPerMinute: 60,
  concurrency: 5,
};

export function isMailTransport(value: string): value is MailTransport {
  return (
    (MAIL_TRANSPORTS as readonly string[]).includes(value) ||
    /^plugin:[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(value)
  );
}

export function isSmtpSecure(value: string): value is SmtpSecure {
  return (SMTP_SECURE_MODES as readonly string[]).includes(value);
}

/** Nodemailer transport options derived from stored mail settings. */
export function buildTransportOptions(config: MailConfig): Record<string, unknown> {
  if (config.transport === "sendmail") {
    return {
      sendmail: true,
      newline: "unix",
      path: process.env.MAIL_SENDMAIL_PATH || "/usr/sbin/sendmail",
    };
  }

  const port = Number.isFinite(config.smtpPort) && config.smtpPort > 0 ? config.smtpPort : 25;
  const options: Record<string, unknown> = {
    host: config.smtpHost.trim() || "localhost",
    port,
    secure: config.smtpSecure === "ssl",
  };

  if (config.smtpSecure === "starttls") {
    options.requireTLS = true;
  }

  if (config.smtpUser.trim()) {
    options.auth = {
      user: config.smtpUser.trim(),
      pass: config.smtpPass,
    };
  }

  return options;
}

export function formatFromHeader(name: string, address: string): string {
  const trimmedName = name.trim();
  const trimmedAddress = address.trim();
  if (!trimmedName) return trimmedAddress;
  const safe = trimmedName.replaceAll(/["\\]/g, "");
  return `"${safe}" <${trimmedAddress}>`;
}

export function escapeMailHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function wrapMailHtml(bodyText: string, footer: string): string {
  const paragraphs = escapeMailHtml(bodyText)
    .split("\n")
    .map((line) => (line.trim() ? `<p style="margin:0 0 12px">${line}</p>` : "<br>"))
    .join("\n");
  return `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a">
${paragraphs}
<p style="margin-top:24px;font-size:12px;color:#64748b">${escapeMailHtml(footer)}</p>
</body></html>`;
}
