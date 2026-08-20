import { describe, expect, it } from "vitest";
import {
  buildTransportOptions,
  escapeMailHtml,
  formatFromHeader,
  wrapMailHtml,
  type MailConfig,
} from "../mail-config.js";

const smtp: MailConfig = {
  transport: "smtp",
  fromName: "Acme",
  smtpHost: "mail.example.com",
  smtpPort: 587,
  smtpSecure: "starttls",
  smtpUser: "site@example.com",
  smtpPass: "secret",
};

describe("buildTransportOptions", () => {
  it("uses sendmail by default path", () => {
    const options = buildTransportOptions({
      ...smtp,
      transport: "sendmail",
    });
    expect(options.sendmail).toBe(true);
    expect(options.newline).toBe("unix");
    expect(String(options.path)).toContain("sendmail");
    expect(options.auth).toBeUndefined();
  });

  it("builds authenticated SMTP with STARTTLS", () => {
    const options = buildTransportOptions(smtp);
    expect(options).toMatchObject({
      host: "mail.example.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "site@example.com", pass: "secret" },
    });
  });

  it("uses implicit TLS for ssl", () => {
    const options = buildTransportOptions({ ...smtp, smtpSecure: "ssl", smtpPort: 465 });
    expect(options.secure).toBe(true);
    expect(options.requireTLS).toBeUndefined();
  });
});

describe("formatFromHeader", () => {
  it("quotes a display name", () => {
    expect(formatFromHeader("My Site", "admin@example.com")).toBe('"My Site" <admin@example.com>');
  });

  it("omits an empty name", () => {
    expect(formatFromHeader("  ", "admin@example.com")).toBe("admin@example.com");
  });
});

describe("wrapMailHtml", () => {
  it("escapes user content", () => {
    const html = wrapMailHtml('Hello <script>alert(1)</script>', "Sent by Test");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("escapeMailHtml", () => {
  it("escapes quotes", () => {
    expect(escapeMailHtml('"hi"')).toBe("&quot;hi&quot;");
  });
});
