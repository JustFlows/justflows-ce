// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  ownMail: true,
}));

vi.mock("../../../src/lib/settings/site-settings.js", () => ({
  getSiteId: async () => "site-b",
  getSiteSetting: async (siteId: string, key: string) => state.settings.get(`${siteId}:${key}`) ?? null,
  setSiteSetting: async () => {},
  settingsKeyColumn: () => "setting_key",
  parseSettingValue: (exists: boolean, value: unknown) => (exists ? value : null),
}));
vi.mock("../../../src/lib/database/db.js", () => ({
  getDb: async () => ({ query: async () => [] }),
  getControlDb: async () => ({
    query: async (_sql: string, [siteId, key]: [string, string]) => {
      const value = state.settings.get(`${siteId}:${key}`);
      return value === undefined ? [] : [{ value }];
    },
  }),
}));
vi.mock("../../../src/lib/tenancy/registry.js", () => ({
  installationRootSiteId: async () => "root",
}));
vi.mock("../../../src/lib/tenancy/quotas.js", () => ({
  checkQuota: async () => ({ ok: state.ownMail }),
}));
vi.mock("../../../src/lib/settings/general-settings.js", () => ({
  getGeneralSettings: async () => ({ adminEmail: "owner@site-b.test" }),
}));

import { deliveryMailConfig } from "../../../src/lib/email/mail.js";

const ROOT_MAIL = { transport: "smtp", smtpHost: "localhost", smtpPort: 587, fromAddress: "noreply@platform.test" };

describe("sub-site mail delivery", () => {
  beforeEach(() => {
    state.settings.clear();
    state.ownMail = true;
    state.settings.set("root:mail", ROOT_MAIL);
  });

  it("sends a sub-site without its own transport through the root site's settings", async () => {
    const resolved = await deliveryMailConfig("site-b");
    expect(resolved.viaPlatform).toBe(true);
    expect(resolved.config).toMatchObject({
      transport: "smtp",
      smtpHost: "localhost",
      fromAddress: "noreply@platform.test",
      replyTo: "owner@site-b.test",
    });
  });

  it("never uses sendmail for a sub-site that chose it", async () => {
    state.settings.set("site-b:mail", { transport: "sendmail", fromName: "Shop" });
    const resolved = await deliveryMailConfig("site-b");
    expect(resolved.config.transport).toBe("smtp");
    expect(resolved.config.fromName).toBe("Shop");
  });

  it("keeps a sub-site's own SMTP when its plan allows it", async () => {
    state.settings.set("site-b:mail", { transport: "smtp", smtpHost: "smtp.site-b.test", smtpPort: 587 });
    const resolved = await deliveryMailConfig("site-b");
    expect(resolved.viaPlatform).toBeUndefined();
    expect(resolved.config.smtpHost).toBe("smtp.site-b.test");
  });

  it("ignores a sub-site's own SMTP when its plan turns own email settings off", async () => {
    state.ownMail = false;
    state.settings.set("site-b:mail", { transport: "smtp", smtpHost: "smtp.site-b.test", smtpPort: 587 });
    const resolved = await deliveryMailConfig("site-b");
    expect(resolved.viaPlatform).toBe(true);
    expect(resolved.config.smtpHost).toBe("localhost");
  });

  it("falls back to the root administration email as the sender", async () => {
    state.settings.set("root:mail", { transport: "smtp", smtpHost: "localhost", smtpPort: 587 });
    state.settings.set("root:admin_email", "admin@platform.test");
    expect((await deliveryMailConfig("site-b")).config.fromAddress).toBe("admin@platform.test");
  });

  it("leaves the root site on its own settings, sendmail included", async () => {
    state.settings.set("root:mail", { transport: "sendmail" });
    const resolved = await deliveryMailConfig("root");
    expect(resolved.viaPlatform).toBeUndefined();
    expect(resolved.config.transport).toBe("sendmail");
  });
});
