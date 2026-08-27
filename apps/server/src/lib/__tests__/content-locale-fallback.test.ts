import { describe, expect, it, vi } from "vitest";

const siteId = "site-1";

const englishContact: Record<string, unknown> = {
  id: "page-contact",
  site_id: siteId,
  type: "page",
  title: "Get in touch",
  slug: "contact",
  locale: "en",
  translation_group_id: "group-contact",
  excerpt: null,
  status: "published",
  blocks: { version: 1, blocks: [] },
  fields: {},
  author_id: null,
  published_at: "2026-01-01 00:00:00",
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-01 00:00:00",
  version: 1,
};

const dutchAbout: Record<string, unknown> = {
  ...englishContact,
  id: "page-about-nl",
  title: "Over ons",
  slug: "over-ons",
  locale: "nl",
  translation_group_id: "group-about",
};

const englishAbout: Record<string, unknown> = {
  ...englishContact,
  id: "page-about",
  title: "About us",
  slug: "about-us",
  locale: "en",
  translation_group_id: "group-about",
};

vi.mock("../db.js", () => ({
  getDb: async () => ({
    query: async (sql: string, params: unknown[] = []) => {
      if (/FROM sites/i.test(sql)) return [{ id: siteId }];
      if (/translation_group_id = \?/i.test(sql)) {
        const [, groupId, locale] = params;
        if (groupId === "group-about" && locale === "nl") return [dutchAbout];
        return [];
      }
      if (/slug = \? AND locale = \?/i.test(sql)) {
        const [, slug, locale] = params;
        if (slug === "contact" && locale === "en") return [englishContact];
        if (slug === "contact" && locale === "nl") return [];
        if (slug === "about-us" && locale === "en") return [englishAbout];
        if (slug === "about-us" && locale === "nl") return [];
        if (slug === "missing" && locale === "en") return [];
        if (slug === "missing" && locale === "nl") return [];
        return [];
      }
      return [];
    },
    run: async () => {},
    close: async () => {},
  }),
  resetDb: () => {},
}));

vi.mock("../i18n/languages-db.js", () => ({
  resolveContentLocale: async (requested?: string) => requested || "en",
  getDefaultLocale: async () => "en",
}));

vi.mock("../content-revisions.js", () => ({
  overlayWorkingOnRow: async (row: Record<string, unknown>) => row,
}));

vi.mock("../jf-cache.js", () => ({
  getJfCache: () => ({
    remember: async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
  }),
}));

vi.mock("../cache-revalidate.js", () => ({
  revalidateOnUpdate: async () => {},
}));

const { getPublishedContentBySlug } = await import("../content-public.js");

describe("getPublishedContentBySlug locale fallback", () => {
  it("falls back to the default language when a translation is missing", async () => {
    const content = await getPublishedContentBySlug("contact", "nl");
    expect(content?.slug).toBe("contact");
    expect(content?.locale).toBe("en");
    expect(content?.title).toBe("Get in touch");
  });

  it("uses the requested-locale translation when one exists in the same group", async () => {
    const content = await getPublishedContentBySlug("about-us", "nl");
    expect(content?.slug).toBe("over-ons");
    expect(content?.locale).toBe("nl");
    expect(content?.title).toBe("Over ons");
  });

  it("returns null when the slug does not exist in any language", async () => {
    expect(await getPublishedContentBySlug("missing", "nl")).toBeNull();
  });
});
