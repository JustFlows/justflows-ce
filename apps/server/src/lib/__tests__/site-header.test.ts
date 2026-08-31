import { beforeEach, describe, expect, it, vi } from "vitest";

const parts = new Map<string, { doc: unknown; draft: unknown }>();
const clone = (v: unknown) => (v == null ? null : JSON.parse(JSON.stringify(v)));
const rowFor = (part: string) => parts.get(part) ?? { doc: null, draft: null };

vi.mock("../template-parts-db.js", () => ({
  getTemplatePartDoc: async (_s: string, part: string, opts: { draft?: boolean } = {}) =>
    clone(opts.draft ? rowFor(part).draft : rowFor(part).doc),
  getTemplatePartDocs: async (_s: string, part: string) => ({
    doc: clone(rowFor(part).doc),
    draft: clone(rowFor(part).draft),
  }),
  templatePartHasDraft: async (_s: string, part: string) => rowFor(part).draft != null,
  saveTemplatePartDraft: async (_s: string, part: string, doc: unknown) => {
    parts.set(part, { ...rowFor(part), draft: clone(doc) });
  },
  saveTemplatePartPublished: async (_s: string, part: string, doc: unknown) => {
    parts.set(part, { ...rowFor(part), doc: clone(doc) });
  },
  publishTemplatePartDoc: async (_s: string, part: string, doc: unknown) => {
    parts.set(part, { doc: clone(doc), draft: null });
  },
  clearTemplatePartDraftDoc: async (_s: string, part: string) => {
    parts.set(part, { ...rowFor(part), draft: null });
  },
  seedTemplatePartRow: async (_s: string, part: string, doc: unknown, draft: unknown) => {
    parts.set(part, { doc: clone(doc), draft: clone(draft) });
  },
}));

const {
  parseSiteHeaderLibrary,
  resolveHeaderEntry,
  headerConfigForLocale,
  getSiteHeaderLibrary,
  getEffectiveSiteHeaderLibrary,
  saveSiteHeaderLibrary,
  publishSiteHeaderLibrary,
  listSiteHeaderOptions,
  MAX_HEADER_ENTRIES,
  SITE_DEFAULT_HEADER_REF,
  NO_HEADER_REF,
} = await import("../site-header.js");
const { DEFAULT_PAGE_HEADER } = await import("../page-header.js");

const SITE = "site-1";

function entry(id: string, over: Record<string, unknown> = {}) {
  return { id, name: id, base: {}, overrides: {}, updatedAt: "2026-01-01T00:00:00Z", ...over };
}

beforeEach(() => parts.clear());

describe("parseSiteHeaderLibrary", () => {
  it("returns an empty library for junk", () => {
    for (const junk of [undefined, null, "x", 42, []]) {
      expect(parseSiteHeaderLibrary(junk)).toEqual({ version: 1, defaultId: null, entries: [] });
    }
  });

  it("drops entries with an invalid or missing id and de-dupes", () => {
    const lib = parseSiteHeaderLibrary({
      defaultId: "a",
      entries: [entry("a"), entry("../etc"), { name: "no id" }, entry("a")],
    });
    expect(lib.entries.map((e) => e.id)).toEqual(["a"]);
    expect(lib.defaultId).toBe("a");
  });

  it("caps the entry count", () => {
    const entries = Array.from({ length: MAX_HEADER_ENTRIES + 20 }, (_, i) => entry(`h${i}`));
    expect(parseSiteHeaderLibrary({ entries }).entries).toHaveLength(MAX_HEADER_ENTRIES);
  });

  it("nulls a defaultId that names no surviving entry", () => {
    expect(parseSiteHeaderLibrary({ defaultId: "ghost", entries: [entry("a")] }).defaultId).toBeNull();
  });

  it("keeps only sparse, valid override keys", () => {
    const lib = parseSiteHeaderLibrary({
      entries: [entry("a", { overrides: { "nl-NL": { sticky: false, layout: "bogus" }, "": { sticky: true } } })],
    });
    expect(lib.entries[0]!.overrides).toEqual({ "nl-NL": { sticky: false, layout: "logo-left" } });
  });
});

describe("resolveHeaderEntry", () => {
  const lib = parseSiteHeaderLibrary({ defaultId: "def", entries: [entry("def"), entry("alt")] });

  it("hides the header for the none ref", () => {
    expect(resolveHeaderEntry(lib, NO_HEADER_REF)).toEqual({ entry: null, hidden: true });
  });

  it("returns the default for an empty or default ref", () => {
    expect(resolveHeaderEntry(lib, "").entry?.id).toBe("def");
    expect(resolveHeaderEntry(lib, SITE_DEFAULT_HEADER_REF).entry?.id).toBe("def");
  });

  it("returns a named entry, falling back to the default for an unknown id", () => {
    expect(resolveHeaderEntry(lib, "alt").entry?.id).toBe("alt");
    expect(resolveHeaderEntry(lib, "missing").entry?.id).toBe("def");
  });

  it("returns no entry when the library has no default", () => {
    const bare = parseSiteHeaderLibrary({ entries: [entry("a")] });
    expect(resolveHeaderEntry(bare, SITE_DEFAULT_HEADER_REF)).toEqual({ entry: null, hidden: false });
  });
});

describe("headerConfigForLocale", () => {
  it("falls back to the built-in default for a null entry", () => {
    expect(headerConfigForLocale(null, "en-US")).toEqual({ ...DEFAULT_PAGE_HEADER, blocks: [] });
  });

  it("merges the exact-locale override over the base, leaving other locales on the base", () => {
    const [e] = parseSiteHeaderLibrary({
      entries: [entry("a", { base: { sticky: true, background: "#fff" }, overrides: { "nl-NL": { sticky: false } } })],
    }).entries;
    expect(headerConfigForLocale(e!, "nl-NL").sticky).toBe(false);
    expect(headerConfigForLocale(e!, "nl-NL").background).toBe("#fff");
    expect(headerConfigForLocale(e!, "de-DE").sticky).toBe(true);
  });
});

describe("draft / publish", () => {
  const draftLib = { version: 1, defaultId: "d", entries: [entry("d", { name: "Draft" })] };
  const liveLib = { version: 1, defaultId: "d", entries: [entry("d", { name: "Live" })] };

  it("keeps a draft save out of the published copy", async () => {
    await saveSiteHeaderLibrary(SITE, liveLib, false);
    await saveSiteHeaderLibrary(SITE, draftLib, true);
    expect((await getSiteHeaderLibrary(SITE, false)).entries[0]!.name).toBe("Live");
    expect((await getEffectiveSiteHeaderLibrary(SITE, false)).entries[0]!.name).toBe("Live");
    expect((await getEffectiveSiteHeaderLibrary(SITE, true)).entries[0]!.name).toBe("Draft");
  });

  it("publish writes the published copy and clears the draft", async () => {
    await saveSiteHeaderLibrary(SITE, draftLib, true);
    await publishSiteHeaderLibrary(SITE, liveLib);
    expect((await getSiteHeaderLibrary(SITE, false)).entries[0]!.name).toBe("Live");
    expect((await getEffectiveSiteHeaderLibrary(SITE, true)).entries[0]!.name).toBe("Live");
  });
});

describe("listSiteHeaderOptions", () => {
  it("reports each entry with an isDefault flag", async () => {
    await publishSiteHeaderLibrary(SITE, {
      version: 1,
      defaultId: "b",
      entries: [entry("a", { name: "A" }), entry("b", { name: "B" })],
    });
    expect(await listSiteHeaderOptions(SITE)).toEqual({
      defaultId: "b",
      items: [
        { id: "a", name: "A", isDefault: false },
        { id: "b", name: "B", isDefault: true },
      ],
    });
  });
});
