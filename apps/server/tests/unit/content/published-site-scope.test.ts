// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from "vitest";
import { runWithTenant, type TenantRequestContext } from "../../../src/lib/tenancy/context.js";

const workspacePage = {
  id: "page-workspace",
  site_id: "workspace",
  type: "page",
  title: "Dirks website",
  slug: "about",
  locale: "en",
  translation_group_id: "group-about",
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

const subsitePage = {
  ...workspacePage,
  id: "page-subsite",
  site_id: "subsite",
  title: "construction-demo",
  translation_group_id: "group-subsite",
};

const pages = [workspacePage, subsitePage];

vi.mock("../../../src/lib/database/db.js", () => ({
  getDb: async () => ({
    query: async (sql: string, params: unknown[] = []) => {
      if (/FROM sites/i.test(sql)) return [{ id: "workspace" }, { id: "subsite" }];
      if (/translation_group_id = \?/i.test(sql) && /SELECT locale, slug/i.test(sql)) {
        const [siteId, groupId] = params;
        return pages
          .filter((page) => page.site_id === siteId && page.translation_group_id === groupId)
          .map((page) => ({ locale: page.locale, slug: page.slug }));
      }
      if (/slug = \? AND locale = \?/i.test(sql)) {
        const [siteId, slug, locale] = params;
        return pages.filter(
          (page) => page.site_id === siteId && page.slug === slug && page.locale === locale,
        );
      }
      return [];
    },
    run: async () => {},
  }),
}));

vi.mock("../../../src/lib/i18n/languages-db.js", () => ({
  resolveContentLocale: async (requested?: string) => requested || "en",
  getDefaultLocale: async () => "en",
}));

vi.mock("../../../src/lib/content/content-revisions.js", () => ({
  overlayWorkingOnRow: async (row: Record<string, unknown>) => row,
}));

vi.mock("../../../src/lib/cache/jf-cache.js", () => ({
  getJfCache: () => ({
    remember: async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
  }),
}));

vi.mock("../../../src/lib/cache/cache-revalidate.js", () => ({
  revalidateOnUpdate: async () => {},
}));

const { getPublishedContentBySlug, getTranslationAlternates } = await import(
  "../../../src/lib/content/content-public.js"
);

function tenant(siteId: string): TenantRequestContext {
  return {
    tenantId: "tenant",
    siteId,
    hostname: `${siteId}.example.com`,
    userMode: "isolated",
    databaseMode: "current",
    rootSite: siteId === "workspace",
    activePluginIds: null,
  };
}

describe("published content on a sub-site", () => {
  it("returns that site's page instead of the first website in the database", async () => {
    const content = await runWithTenant(tenant("subsite"), () =>
      getPublishedContentBySlug("about", "en"),
    );
    expect(content?.title).toBe("construction-demo");
    expect(content?.siteId).toBe("subsite");
  });

  it("returns no page when the request is not bound to one website", async () => {
    expect(await getPublishedContentBySlug("about", "en")).toBeNull();
  });

  it("lists translations for the current website only", async () => {
    const alternates = await runWithTenant(tenant("subsite"), () =>
      getTranslationAlternates("group-about"),
    );
    expect(alternates).toEqual([]);
    const own = await runWithTenant(tenant("subsite"), () =>
      getTranslationAlternates("group-subsite"),
    );
    expect(own).toEqual([{ locale: "en", slug: "about" }]);
  });
});
