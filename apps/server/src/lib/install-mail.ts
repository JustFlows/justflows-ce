// SPDX-License-Identifier: MIT

import nodemailer from "nodemailer";
import {
  buildTransportOptions,
  DEFAULT_MAIL_CONFIG,
  formatFromHeader,
  isMailTransport,
  isSmtpSecure,
  wrapMailHtml,
  type MailConfig,
} from "./mail-config.js";

export interface InstallDetailsMailInput {
  to: string;
  siteName: string;
  siteUrl: string;
  locale: string;
  localeName: string;
  username: string;
  email: string;
  password: string;
  dbDriver: string;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
}

export type MailResult = { ok: true } | { ok: false; error: string };

function envMailConfig(): MailConfig {
  const out: MailConfig = { ...DEFAULT_MAIL_CONFIG };
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

function adminUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/admin`;
}

/** Plain-text body for the optional post-install credentials email. */
export function buildInstallDetailsEmail(input: InstallDetailsMailInput): {
  subject: string;
  text: string;
} {
  const name = input.siteName.trim() || "Your site";
  const url = input.siteUrl.replace(/\/+$/, "");
  const text = [
    `${name} is installed.`,
    "",
    "Site",
    `Name: ${name}`,
    `URL: ${url}`,
    `Admin: ${adminUrl(url)}`,
    `Default language: ${input.localeName} (${input.locale})`,
    "",
    "Administrator account",
    `Email: ${input.email}`,
    `Username: ${input.username}`,
    `Password: ${input.password}`,
    "",
    "Database",
    `Type: ${input.dbDriver}`,
    `Host: ${input.dbHost}:${input.dbPort}`,
    `Name: ${input.dbName}`,
    `Username: ${input.dbUser}`,
    "",
    "Keep this message private — it includes your admin password. You can change that password after you sign in.",
  ].join("\n");

  return {
    subject: `[${name}] Site details and admin credentials`,
    text,
  };
}

/** Send using the host mailer / SMTP env. Does not read site_settings (install-time). */
export async function sendInstallDetailsMail(input: InstallDetailsMailInput): Promise<MailResult> {
  const to = input.to.trim();
  if (!to || !to.includes("@")) {
    return { ok: false, error: "No recipient address" };
  }

  const { subject, text } = buildInstallDetailsEmail(input);
  const config = envMailConfig();
  const from = formatFromHeader(input.siteName.trim() || "Justflows", to);

  try {
    const transporter = nodemailer.createTransport(
      buildTransportOptions(config) as Parameters<typeof nodemailer.createTransport>[0],
    );
    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html: wrapMailHtml(text, `Sent by ${input.siteName.trim() || "Justflows"}`),
    });
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("Install details mail failed:", JSON.stringify(detail.replace(/\n/g, "").replace(/\r/g, "")));
    return { ok: false, error: "send_failed" };
  }
}
