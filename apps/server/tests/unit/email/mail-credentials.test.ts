// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../../../src/lib/settings/site-settings.js", () => ({
  getSiteId: async () => "site-b",
  getSiteSetting: async (siteId: string, key: string) => store.get(`${siteId}:${key}`) ?? null,
  setSiteSetting: async (siteId: string, key: string, value: unknown) => {
    store.set(`${siteId}:${key}`, value);
  },
}));
vi.mock("../../../src/lib/security/secret-box.js", () => ({
  encryptSecret: (value: string) => `enc:${value}`,
  decryptSecret: (value: unknown) => String(value).replace(/^enc:/, ""),
}));

import { getMailConfig, saveMailConfig } from "../../../src/lib/email/mail.js";
import { buildTransportOptions } from "../../../src/lib/email/mail-config.js";

const ENV = { SMTP_HOST: "relay.platform.test", SMTP_PORT: "587", SMTP_USER: "platform-user", SMTP_PASS: "platform-secret" };

describe("installation SMTP credentials", () => {
  beforeEach(() => {
    store.clear();
    for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("pairs installation credentials only with the installation relay", async () => {
    const config = await getMailConfig("site-b");
    expect(buildTransportOptions({ ...config, transport: "smtp" })).toMatchObject({
      host: "relay.platform.test",
      auth: { user: "platform-user", pass: "platform-secret" },
    });
  });

  it("never sends installation credentials to a server a site chose", async () => {
    await saveMailConfig("site-b", { transport: "smtp", smtpHost: "smtp.attacker.test", smtpPort: 587 });
    const config = await getMailConfig("site-b");
    const options = buildTransportOptions(config);
    expect(options.host).toBe("smtp.attacker.test");
    expect(JSON.stringify(options)).not.toContain("platform-secret");
    expect(JSON.stringify(store.get("site-b:mail"))).not.toContain("platform-secret");
  });

  it("does not let a blank password carry over to a new server or account", async () => {
    await saveMailConfig("site-b", {
      transport: "smtp",
      smtpHost: "smtp.example.test",
      smtpUser: "me",
      smtpPass: "site-secret",
    });
    await saveMailConfig("site-b", { smtpHost: "smtp.example.test", smtpPass: "" });
    expect((await getMailConfig("site-b")).smtpPass).toBe("site-secret");

    await saveMailConfig("site-b", { smtpHost: "smtp.elsewhere.test", smtpPass: "" });
    expect((await getMailConfig("site-b")).smtpPass).toBe("");
  });

  it("does not copy the installation password into a site's record on an unrelated save", async () => {
    await saveMailConfig("site-b", { fromName: "Shop" });
    expect(JSON.stringify(store.get("site-b:mail"))).not.toContain("platform-secret");
    expect((await getMailConfig("site-b")).smtpPass).toBe("platform-secret");
  });
});
