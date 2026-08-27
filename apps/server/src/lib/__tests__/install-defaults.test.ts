// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { freshInstallSiteSettings, parseInstallLocale, siteSettingsInsertSql } from "../install-defaults.js";

describe("freshInstallSiteSettings", () => {
  it("starts private, with search engines discouraged, and records the admin email", () => {
    const settings = Object.fromEntries(freshInstallSiteSettings("admin@example.com"));
    expect(settings.site_public).toBe(false);
    expect(settings.discourage_search_engines).toBe(true);
    expect(settings.admin_email).toBe("admin@example.com");
  });
});

describe("siteSettingsInsertSql", () => {
  it("quotes the reserved key column on MySQL and MariaDB", () => {
    expect(siteSettingsInsertSql("mysql")).toContain("`key`");
    expect(siteSettingsInsertSql("mariadb")).toContain("`key`");
  });

  it("leaves the identifier bare on PostgreSQL", () => {
    expect(siteSettingsInsertSql("postgres")).toContain("site_id, key, value");
    expect(siteSettingsInsertSql("postgres")).not.toContain("`");
  });
});

describe("parseInstallLocale", () => {
  it("falls back to en-US when omitted", () => {
    const parsed = parseInstallLocale(undefined);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.meta.code).toBe("en-US");
  });

  it("canonicalizes a chosen tag and uses it as the default language", () => {
    const parsed = parseInstallLocale("nl-nl");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.meta.code).toBe("nl-NL");
      expect(parsed.meta.nativeName.toLowerCase()).toContain("nederlands");
    }
  });

  it("rejects an invalid tag", () => {
    const parsed = parseInstallLocale("english");
    expect(parsed).toEqual({
      ok: false,
      error: "Enter a valid language code such as en-US or nl-NL.",
    });
  });
});
