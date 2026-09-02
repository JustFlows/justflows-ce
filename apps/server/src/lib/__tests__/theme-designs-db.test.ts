// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DB_DRIVER = "postgres";

// In-memory stand-in for the theme_designs table, keyed by (site, theme, kind).
const table = new Map<string, { doc: string; draft_doc: string | null }>();
const key = (site: unknown, theme: unknown, kind: unknown) => `${site}::${theme}::${kind}`;

vi.mock("../db.js", () => ({
  getDb: async () => ({
    async query(sql: string, params: unknown[] = []) {
      if (/SELECT doc, draft_doc FROM theme_designs/i.test(sql)) {
        const row = table.get(key(params[0], params[1], params[2]));
        return row ? [row] : [];
      }
      return [];
    },
    async run(sql: string, params: unknown[] = []) {
      if (!/INSERT INTO theme_designs/i.test(sql)) return;
      // params: [id, site, theme, kind, docJson, draftJson, stamp, stamp]
      const [, site, theme, kind, docJson, draftJson] = params as string[];
      const k = key(site, theme, kind);
      const existing = table.get(k);
      const setsDoc = /doc = EXCLUDED\.doc/.test(sql);
      const setsDraft = /draft_doc = EXCLUDED\.draft_doc/.test(sql);
      if (!existing) {
        table.set(k, { doc: docJson ?? "{}", draft_doc: draftJson ?? null });
        return;
      }
      table.set(k, {
        doc: setsDoc ? (docJson ?? "{}") : existing.doc,
        draft_doc: setsDraft ? (draftJson ?? null) : existing.draft_doc,
      });
    },
  }),
}));

const {
  getThemeDesignDoc,
  getThemeDesignDocs,
  themeDesignHasDraft,
  saveThemeDesignDraft,
  saveThemeDesignPublished,
  publishThemeDesignDoc,
  clearThemeDesignDraftDoc,
  seedThemeDesignRow,
} = await import("../theme-designs-db.js");

const SITE = "site-1";
const THEME = "justflows.default";
beforeEach(() => table.clear());

describe("theme-designs-db", () => {
  it("returns null for an unknown (theme, kind)", async () => {
    expect(await getThemeDesignDoc(SITE, THEME, "mods")).toBeNull();
    expect(await getThemeDesignDocs(SITE, THEME, "home")).toEqual({ doc: null, draft: null });
    expect(await themeDesignHasDraft(SITE, THEME, "mods")).toBe(false);
  });

  it("a draft save leaves the published doc untouched", async () => {
    await saveThemeDesignPublished(SITE, THEME, "mods", { colors: { "--x": "#000" } });
    await saveThemeDesignDraft(SITE, THEME, "mods", { colors: { "--x": "#fff" } });
    expect(await getThemeDesignDoc(SITE, THEME, "mods")).toEqual({ colors: { "--x": "#000" } });
    expect(await getThemeDesignDoc(SITE, THEME, "mods", { draft: true })).toEqual({
      colors: { "--x": "#fff" },
    });
    expect(await themeDesignHasDraft(SITE, THEME, "mods")).toBe(true);
  });

  it("keeps kinds and themes isolated", async () => {
    await saveThemeDesignPublished(SITE, THEME, "home", { version: 1, blocks: ["h"] });
    await saveThemeDesignPublished(SITE, THEME, "blog", { version: 1, blocks: ["b"] });
    await saveThemeDesignPublished(SITE, "other.theme", "home", { version: 1, blocks: ["o"] });
    expect(await getThemeDesignDoc(SITE, THEME, "home")).toEqual({ version: 1, blocks: ["h"] });
    expect(await getThemeDesignDoc(SITE, THEME, "blog")).toEqual({ version: 1, blocks: ["b"] });
    expect(await getThemeDesignDoc(SITE, "other.theme", "home")).toEqual({ version: 1, blocks: ["o"] });
  });

  it("publish sets the doc and clears the draft", async () => {
    await saveThemeDesignDraft(SITE, THEME, "home", { version: 1, blocks: ["wip"] });
    await publishThemeDesignDoc(SITE, THEME, "home", { version: 1, blocks: ["final"] });
    expect(await getThemeDesignDoc(SITE, THEME, "home")).toEqual({ version: 1, blocks: ["final"] });
    expect(await themeDesignHasDraft(SITE, THEME, "home")).toBe(false);
  });

  it("clearThemeDesignDraftDoc drops only the draft", async () => {
    await saveThemeDesignPublished(SITE, THEME, "mods", { a: 1 });
    await saveThemeDesignDraft(SITE, THEME, "mods", { a: 2 });
    await clearThemeDesignDraftDoc(SITE, THEME, "mods");
    expect(await getThemeDesignDoc(SITE, THEME, "mods")).toEqual({ a: 1 });
    expect(await getThemeDesignDoc(SITE, THEME, "mods", { draft: true })).toBeNull();
  });

  it("seedThemeDesignRow writes doc and draft together", async () => {
    await seedThemeDesignRow(SITE, THEME, "mods", { v: "pub" }, { v: "draft" });
    expect(await getThemeDesignDocs(SITE, THEME, "mods")).toEqual({
      doc: { v: "pub" },
      draft: { v: "draft" },
    });
    await seedThemeDesignRow(SITE, THEME, "blog", { v: "pub" }, null);
    expect(await getThemeDesignDocs(SITE, THEME, "blog")).toEqual({ doc: { v: "pub" }, draft: null });
  });
});
