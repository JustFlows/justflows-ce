// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = new Map<string, unknown>();
const rows = new Map<string, { doc: unknown; draft: unknown }>();
const clone = (v: unknown) => (v == null ? null : JSON.parse(JSON.stringify(v)));
const rowKey = (theme: string, kind: string) => `${theme}::${kind}`;
let scanSql = "";

vi.mock("../db.js", () => ({
  getDb: async () => ({
    async query(sql: string) {
      if (/FROM site_settings/i.test(sql)) {
        scanSql = sql;
        return [...settings.keys()].map((setting_key) => ({ setting_key }));
      }
      return [];
    },
  }),
}));

vi.mock("../site-settings.js", () => ({
  settingsKeyColumn: () => "`key`",
  getSiteSetting: async (_s: string, key: string) => (settings.has(key) ? settings.get(key) : null),
  deleteSiteSetting: async (_s: string, key: string) => {
    settings.delete(key);
  },
}));

vi.mock("../theme-designs-db.js", () => ({
  getThemeDesignDoc: async (_s: string, theme: string, kind: string) =>
    clone(rows.get(rowKey(theme, kind))?.doc ?? null),
  seedThemeDesignRow: async (
    _s: string,
    theme: string,
    kind: string,
    doc: unknown,
    draft: unknown,
  ) => {
    rows.set(rowKey(theme, kind), { doc: clone(doc), draft: clone(draft) });
  },
}));

const { migrateThemeDesignsFromSettings } = await import("../theme-designs-migrate.js");

const SITE = "site-1";
beforeEach(() => {
  settings.clear();
  rows.clear();
  scanSql = "";
});

describe("migrateThemeDesignsFromSettings", () => {
  it("moves published + draft docs into the table and deletes the old rows", async () => {
    settings.set("theme_mods.justflows.default", { colors: { "--x": "#000" } });
    settings.set("theme_mods_draft.justflows.default", { colors: { "--x": "#fff" } });
    settings.set("theme_home.justflows.default", { version: 1, blocks: ["h"] });
    settings.set("unrelated_setting", { keep: true });

    await migrateThemeDesignsFromSettings(SITE);

    expect(rows.get(rowKey("justflows.default", "mods"))).toEqual({
      doc: { colors: { "--x": "#000" } },
      draft: { colors: { "--x": "#fff" } },
    });
    expect(rows.get(rowKey("justflows.default", "home"))).toEqual({
      doc: { version: 1, blocks: ["h"] },
      draft: null,
    });
    expect(settings.has("theme_mods.justflows.default")).toBe(false);
    expect(settings.has("theme_mods_draft.justflows.default")).toBe(false);
    expect(settings.has("theme_home.justflows.default")).toBe(false);
    expect(settings.has("unrelated_setting")).toBe(true);
  });

  it("carries a draft-only customization (never published) across the move", async () => {
    settings.set("theme_blog_draft.acme.theme", { version: 1, blocks: ["wip"] });

    await migrateThemeDesignsFromSettings(SITE);

    expect(rows.get(rowKey("acme.theme", "blog"))).toEqual({
      doc: {},
      draft: { version: 1, blocks: ["wip"] },
    });
    expect(settings.has("theme_blog_draft.acme.theme")).toBe(false);
  });

  it("does nothing when there is nothing to move", async () => {
    settings.set("favicon_url", "/x.png");
    await migrateThemeDesignsFromSettings(SITE);
    expect(rows.size).toBe(0);
    expect(settings.has("favicon_url")).toBe(true);
  });

  it("uses a non-reserved result alias for MySQL and MariaDB", async () => {
    settings.set("theme_home.justflows.default", { version: 1, blocks: [] });
    await migrateThemeDesignsFromSettings(SITE);
    expect(scanSql).toContain("SELECT `key` AS setting_key");
    expect(scanSql).not.toContain(" AS key ");
  });

  it("does not overwrite a design already in the table, but still cleans stale settings", async () => {
    rows.set(rowKey("justflows.default", "mods"), { doc: { migrated: true }, draft: null });
    settings.set("theme_mods.justflows.default", { stale: true });

    await migrateThemeDesignsFromSettings(SITE);

    expect(rows.get(rowKey("justflows.default", "mods"))!.doc).toEqual({ migrated: true });
    expect(settings.has("theme_mods.justflows.default")).toBe(false);
  });
});
