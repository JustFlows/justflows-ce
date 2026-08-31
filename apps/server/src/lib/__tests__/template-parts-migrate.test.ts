import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = new Map<string, unknown>();
const parts = new Map<string, { doc: unknown; draft: unknown }>();
const clone = (v: unknown) => (v == null ? null : JSON.parse(JSON.stringify(v)));

vi.mock("../site-settings.js", () => ({
  getSiteSetting: async (_s: string, key: string) => (settings.has(key) ? settings.get(key) : null),
  setSiteSetting: async (_s: string, key: string, value: unknown) => settings.set(key, clone(value)),
  deleteSiteSetting: async (_s: string, key: string) => {
    settings.delete(key);
  },
}));

vi.mock("../template-parts-db.js", () => ({
  getTemplatePartDoc: async (_s: string, part: string) => clone(parts.get(part)?.doc ?? null),
  seedTemplatePartRow: async (_s: string, part: string, doc: unknown, draft: unknown) => {
    parts.set(part, { doc: clone(doc), draft: clone(draft) });
  },
}));

const { migrateTemplatePartsFromSettings } = await import("../template-parts-migrate.js");

const SITE = "site-1";
beforeEach(() => {
  settings.clear();
  parts.clear();
});

describe("migrateTemplatePartsFromSettings", () => {
  it("moves published + draft docs into the table and deletes the old rows", async () => {
    settings.set("template_part.footer", { version: 1, blocks: ["f"] });
    settings.set("template_part_draft.footer", { version: 1, blocks: ["f-wip"] });
    settings.set("template_part.header", { version: 1, defaultId: "h1", entries: [] });

    await migrateTemplatePartsFromSettings(SITE);

    expect(parts.get("footer")).toEqual({
      doc: { version: 1, blocks: ["f"] },
      draft: { version: 1, blocks: ["f-wip"] },
    });
    expect(parts.get("header")).toEqual({
      doc: { version: 1, defaultId: "h1", entries: [] },
      draft: null,
    });
    expect(settings.has("template_part.footer")).toBe(false);
    expect(settings.has("template_part_draft.footer")).toBe(false);
    expect(settings.has("template_part.header")).toBe(false);
  });

  it("does nothing when there is nothing in settings", async () => {
    await migrateTemplatePartsFromSettings(SITE);
    expect(parts.size).toBe(0);
  });

  it("does not overwrite a part already in the table, but still cleans stale settings", async () => {
    parts.set("footer", { doc: { version: 1, blocks: ["already-migrated"] }, draft: null });
    settings.set("template_part.footer", { version: 1, blocks: ["stale"] });

    await migrateTemplatePartsFromSettings(SITE);

    expect(parts.get("footer")!.doc).toEqual({ version: 1, blocks: ["already-migrated"] });
    expect(settings.has("template_part.footer")).toBe(false);
  });
});
