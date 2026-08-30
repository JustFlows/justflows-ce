import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DB_DRIVER = "postgres";

// In-memory stand-in for the template_parts table, keyed by (site_id, part).
const table = new Map<string, { doc: string; draft_doc: string | null }>();
const key = (site: unknown, part: unknown) => `${site}::${part}`;

vi.mock("../db.js", () => ({
  getDb: async () => ({
    async query(sql: string, params: unknown[] = []) {
      if (/SELECT doc, draft_doc FROM template_parts/i.test(sql)) {
        const row = table.get(key(params[0], params[1]));
        return row ? [row] : [];
      }
      return [];
    },
    async run(sql: string, params: unknown[] = []) {
      if (!/INSERT INTO template_parts/i.test(sql)) return;
      // params: [id, site, part, docJson, draftJson, stamp, stamp]
      const [, site, part, docJson, draftJson] = params as string[];
      const k = key(site, part);
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
  getTemplatePartDoc,
  getTemplatePartDocs,
  templatePartHasDraft,
  saveTemplatePartDraft,
  saveTemplatePartPublished,
  publishTemplatePartDoc,
  clearTemplatePartDraftDoc,
  seedTemplatePartRow,
} = await import("../template-parts-db.js");

const SITE = "site-1";
beforeEach(() => table.clear());

describe("template-parts-db", () => {
  it("returns null for an unknown part", async () => {
    expect(await getTemplatePartDoc(SITE, "footer")).toBeNull();
    expect(await getTemplatePartDocs(SITE, "footer")).toEqual({ doc: null, draft: null });
    expect(await templatePartHasDraft(SITE, "footer")).toBe(false);
  });

  it("a draft save leaves the published doc untouched", async () => {
    await saveTemplatePartPublished(SITE, "footer", { version: 1, blocks: ["live"] });
    await saveTemplatePartDraft(SITE, "footer", { version: 1, blocks: ["wip"] });
    expect(await getTemplatePartDoc(SITE, "footer")).toEqual({ version: 1, blocks: ["live"] });
    expect(await getTemplatePartDoc(SITE, "footer", { draft: true })).toEqual({ version: 1, blocks: ["wip"] });
    expect(await templatePartHasDraft(SITE, "footer")).toBe(true);
  });

  it("publish sets the doc and clears the draft", async () => {
    await saveTemplatePartDraft(SITE, "footer", { version: 1, blocks: ["wip"] });
    await publishTemplatePartDoc(SITE, "footer", { version: 1, blocks: ["final"] });
    expect(await getTemplatePartDoc(SITE, "footer")).toEqual({ version: 1, blocks: ["final"] });
    expect(await templatePartHasDraft(SITE, "footer")).toBe(false);
  });

  it("clearTemplatePartDraftDoc drops only the draft", async () => {
    await saveTemplatePartPublished(SITE, "header", { a: 1 });
    await saveTemplatePartDraft(SITE, "header", { a: 2 });
    await clearTemplatePartDraftDoc(SITE, "header");
    expect(await getTemplatePartDoc(SITE, "header")).toEqual({ a: 1 });
    expect(await getTemplatePartDoc(SITE, "header", { draft: true })).toBeNull();
  });

  it("seedTemplatePartRow writes doc and draft together", async () => {
    await seedTemplatePartRow(SITE, "footer", { v: "pub" }, { v: "draft" });
    expect(await getTemplatePartDocs(SITE, "footer")).toEqual({ doc: { v: "pub" }, draft: { v: "draft" } });
    await seedTemplatePartRow(SITE, "header", { v: "pub" }, null);
    expect(await getTemplatePartDocs(SITE, "header")).toEqual({ doc: { v: "pub" }, draft: null });
  });
});
