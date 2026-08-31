import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = new Map<string, unknown>();
let rows: { id: string; title: string | null; fields: unknown }[] = [];
const updates: { id: string; fields: string }[] = [];
const revalidated: string[] = [];

vi.mock("../site-settings.js", () => ({
  getSiteSetting: async (_s: string, key: string) => (settings.has(key) ? settings.get(key) : null),
  setSiteSetting: async (_s: string, key: string, value: unknown) => {
    settings.set(key, JSON.parse(JSON.stringify(value)));
  },
  deleteSiteSetting: async (_s: string, key: string) => {
    settings.delete(key);
  },
}));

vi.mock("../cache-revalidate.js", () => ({
  revalidateOnUpdate: async (kind: string) => {
    revalidated.push(kind);
  },
}));

const parts = new Map<string, { doc: unknown; draft: unknown }>();
const cloneJson = (v: unknown) => (v == null ? null : JSON.parse(JSON.stringify(v)));
const partRow = (part: string) => parts.get(part) ?? { doc: null, draft: null };

vi.mock("../template-parts-db.js", () => ({
  getTemplatePartDoc: async (_s: string, part: string, opts: { draft?: boolean } = {}) =>
    cloneJson(opts.draft ? partRow(part).draft : partRow(part).doc),
  getTemplatePartDocs: async (_s: string, part: string) => ({
    doc: cloneJson(partRow(part).doc),
    draft: cloneJson(partRow(part).draft),
  }),
  templatePartHasDraft: async (_s: string, part: string) => partRow(part).draft != null,
  saveTemplatePartDraft: async (_s: string, part: string, doc: unknown) => {
    parts.set(part, { ...partRow(part), draft: cloneJson(doc) });
  },
  saveTemplatePartPublished: async (_s: string, part: string, doc: unknown) => {
    parts.set(part, { ...partRow(part), doc: cloneJson(doc) });
  },
  publishTemplatePartDoc: async (_s: string, part: string, doc: unknown) => {
    parts.set(part, { doc: cloneJson(doc), draft: null });
  },
  clearTemplatePartDraftDoc: async (_s: string, part: string) => {
    parts.set(part, { ...partRow(part), draft: null });
  },
  seedTemplatePartRow: async (_s: string, part: string, doc: unknown, draft: unknown) => {
    parts.set(part, { doc: cloneJson(doc), draft: cloneJson(draft) });
  },
}));

vi.mock("../db.js", () => ({
  getDb: async () => ({
    query: async (sql: string) => {
      if (/FROM content/i.test(sql)) return rows;
      return [];
    },
    run: async (sql: string, params: unknown[] = []) => {
      if (/UPDATE content SET fields/i.test(sql)) {
        updates.push({ id: String(params[1]), fields: String(params[0]) });
      }
    },
  }),
}));

const { backfillSiteHeaderLibrary } = await import("../site-header-backfill.js");
const { getSiteHeaderLibrary } = await import("../site-header.js");
const { DEFAULT_PAGE_HEADER } = await import("../page-header.js");

const SITE = "site-1";
const customA = { ...DEFAULT_PAGE_HEADER, sticky: false, background: "#101010" };
const customB = { ...DEFAULT_PAGE_HEADER, layout: "split" };
const hidden = { ...DEFAULT_PAGE_HEADER, visible: false };

beforeEach(() => {
  settings.clear();
  parts.clear();
  updates.length = 0;
  revalidated.length = 0;
  rows = [
    { id: "p-default", title: "Home", fields: { jfHeader: { ...DEFAULT_PAGE_HEADER } } },
    { id: "p-a1", title: "About", fields: { jfHeader: customA } },
    { id: "p-a2", title: "Team", fields: { jfHeader: { ...customA } } },
    { id: "p-b", title: "Shop", fields: { jfHeader: customB } },
    { id: "p-hidden", title: "Landing", fields: { jfHeader: hidden } },
    { id: "p-none", title: "Post", fields: { seoTitle: "x" } },
  ];
});

describe("backfillSiteHeaderLibrary", () => {
  it("seeds a default entry and one deduped entry per distinct custom header", async () => {
    await backfillSiteHeaderLibrary(SITE);

    const lib = await getSiteHeaderLibrary(SITE, false);
    expect(lib.defaultId).toBeTruthy();
    const names = lib.entries.map((e) => e.name);
    expect(names[0]).toBe("Site header");
    expect(lib.entries).toHaveLength(3); // default + A + B

    // p-a1 and p-a2 collapse to the same entry id; p-b gets its own; p-hidden maps to
    // "none"; p-default & p-none are left untouched.
    const linked = Object.fromEntries(updates.map((u) => [u.id, JSON.parse(u.fields).jfHeaderRef]));
    expect(Object.keys(linked).sort()).toEqual(["p-a1", "p-a2", "p-b", "p-hidden"]);
    expect(linked["p-a1"]).toBe(linked["p-a2"]);
    expect(linked["p-b"]).not.toBe(linked["p-a1"]);
    expect(linked["p-hidden"]).toBe("__none__");
    expect(lib.entries.some((e) => e.id === linked["p-a1"])).toBe(true);

    expect(settings.get("site_header_migrated")).toBe(true);
    expect(revalidated).toContain("content");
  });

  it("is a no-op on a second run", async () => {
    await backfillSiteHeaderLibrary(SITE);
    updates.length = 0;
    revalidated.length = 0;
    await backfillSiteHeaderLibrary(SITE);
    expect(updates).toHaveLength(0);
  });

  it("does not link pages whose header already matches the default", async () => {
    await backfillSiteHeaderLibrary(SITE);
    expect(updates.some((u) => u.id === "p-default")).toBe(false);
    expect(updates.some((u) => u.id === "p-none")).toBe(false);
  });
});
