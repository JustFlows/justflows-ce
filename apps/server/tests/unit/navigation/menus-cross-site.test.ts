// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Menus must never resolve or store links to another site's content in a
 * shared database. The fake below holds rows for two sites and honours only
 * the `site_id` predicates a query actually carries, so a query that drops
 * them returns the other site's rows, as a real database would.
 */

const SITE_A = "11111111-1111-4111-8111-111111111111";
const SITE_B = "22222222-2222-4222-8222-222222222222";
const OWN_PAGE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN_DRAFT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SHARED_GROUP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function contentRow(id: string, siteId: string, title: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    site_id: siteId,
    type: "page",
    title,
    slug: title.toLowerCase().replace(/\s+/g, "-"),
    locale: "en",
    translation_group_id: null,
    status,
    blocks: "[]",
    fields: "{}",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

const state: { content: Array<Record<string, unknown>>; menuItems: unknown[]; writes: number } = {
  content: [],
  menuItems: [],
  writes: 0,
};

function queryContent(sql: string, params: unknown[]): Array<Record<string, unknown>> {
  const rest = [...params];
  let rows = state.content;
  if (/WHERE site_id = \?/.test(sql)) {
    const site = rest.shift();
    rows = rows.filter((row) => row.site_id === site);
  } else if (/WHERE site_id <> \?/.test(sql)) {
    const site = rest.shift();
    rows = rows.filter((row) => row.site_id !== site);
  }
  if (/translation_group_id IN/.test(sql)) {
    const locale = rest.pop();
    rows = rows.filter((row) => rest.includes(row.translation_group_id) && row.locale === locale);
  } else if (/\bid IN/.test(sql)) {
    rows = rows.filter((row) => rest.includes(row.id));
  }
  if (/status = 'published'/.test(sql)) rows = rows.filter((row) => row.status === "published");
  return rows;
}

vi.mock("../../../src/lib/database/db.js", () => ({
  getDb: async () => ({
    query: async (sql: string, params: unknown[] = []) => {
      if (/FROM content\b/.test(sql)) return queryContent(sql, params);
      if (/FROM menus\b/.test(sql)) {
        return [{ id: "m1", site_id: SITE_A, slug: "primary", name: "Primary", items: JSON.stringify(state.menuItems), design: null, draft_items: null, draft_design: null }];
      }
      return [];
    },
    run: async () => {
      state.writes += 1;
    },
    close: async () => {},
  }),
  resetDb: () => {},
}));

vi.mock("../../../src/lib/i18n/languages-db.js", () => ({
  getActiveLocaleCodes: async () => ["en", "nl"],
}));

vi.mock("../../../src/lib/themes/themes-db.js", () => ({
  getSiteId: async () => SITE_A,
}));

vi.mock("../../../src/lib/navigation/permalinks-db.js", () => ({
  createContentPermalinkResolver: async () => async (content: { slug: string }) => `/${content.slug}`,
}));

vi.mock("../../../src/lib/content/visibility-scope.js", () => ({
  getVisibilityScope: async () => ({ allows: () => true }),
}));

vi.mock("../../../src/lib/plugins/plugin-runtime.js", () => ({
  ensurePluginRuntime: async () => {},
  getRuntimeHooks: () => ({ has: () => false, applyFilter: async (_name: string, value: unknown) => value }),
}));

const { resolveMenuItems, updateMenu, MenuTreeShapeError } = await import("../../../src/lib/navigation/menus-db.js");

beforeEach(() => {
  state.content = [
    contentRow(OWN_PAGE, SITE_A, "About us", "published", { translation_group_id: SHARED_GROUP }),
    contentRow(FOREIGN_DRAFT, SITE_B, "Secret launch plan", "draft"),
    contentRow("dddddddd-dddd-4ddd-8ddd-dddddddddddd", SITE_B, "Geheim", "published", {
      translation_group_id: SHARED_GROUP,
      locale: "nl",
    }),
  ];
  state.menuItems = [];
  state.writes = 0;
});

describe("menu content links stay on their own site", () => {
  it("never resolves another site's content, even its drafts in preview", async () => {
    const items = [{ id: "1", label: "", type: "page" as const, contentId: FOREIGN_DRAFT }];
    const resolved = await resolveMenuItems(items, "en", "en", true, { siteId: SITE_A });
    expect(JSON.stringify(resolved)).not.toContain("Secret launch plan");
    expect(JSON.stringify(resolved)).not.toContain("secret-launch-plan");
  });

  it("still resolves this site's own content", async () => {
    const items = [{ id: "1", label: "", type: "page" as const, contentId: OWN_PAGE }];
    const resolved = await resolveMenuItems(items, "en", "en", false, { siteId: SITE_A });
    expect(resolved).toEqual([expect.objectContaining({ label: "About us", url: "/about-us" })]);
  });

  it("does not pick up another site's translation that shares a group id", async () => {
    const items = [{ id: "1", label: "", type: "page" as const, contentId: OWN_PAGE }];
    const resolved = await resolveMenuItems(items, "nl", "en", false, { siteId: SITE_A });
    expect(JSON.stringify(resolved)).not.toContain("Geheim");
  });

  it("refuses to save an item linking to another site's content", async () => {
    await expect(
      updateMenu(SITE_A, "primary", {
        items: [{ id: "1", label: "x", type: "page", children: [{ id: "2", label: "y", type: "page", contentId: FOREIGN_DRAFT }] }],
      }),
    ).rejects.toBeInstanceOf(MenuTreeShapeError);
    expect(state.writes).toBe(0);
  });

  it("saves links to own content and to ids that no longer exist", async () => {
    const saved = await updateMenu(SITE_A, "primary", {
      items: [
        { id: "1", label: "About", type: "page", contentId: OWN_PAGE },
        { id: "2", label: "Gone", type: "page", contentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
      ],
    });
    expect(saved).not.toBeNull();
    expect(state.writes).toBe(1);
  });
});
