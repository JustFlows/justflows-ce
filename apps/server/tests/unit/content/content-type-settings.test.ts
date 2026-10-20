// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveContentTypeSettings } from "@justflows/content";
const mocks = vi.hoisted(() => ({ query: vi.fn(), run: vi.fn(), clear: vi.fn(), purge: vi.fn() }));
vi.mock("../../../src/lib/database/db.js", () => ({
  getDb: async () => ({ query: mocks.query, run: mocks.run }),
}));
vi.mock("../../../src/lib/database/run-migrations.js", () => ({
  runAllMigrations: async () => undefined,
}));
vi.mock("../../../src/lib/settings/site-settings.js", () => ({
  getSiteSetting: async () => null,
  getSiteId: async () => "site-a",
}));
vi.mock("../../../src/lib/i18n/languages-db.js", () => ({ getDefaultLocale: async () => "en-US" }));
vi.mock("../../../src/lib/cache/cache-revalidate.js", () => ({ revalidateSelected: mocks.clear }));
vi.mock("../../../src/lib/cdn/cdn-purge.js", () => ({ purgeCdnCache: mocks.purge }));
vi.mock("../../../src/lib/plugins/plugin-runtime.js", () => ({
  getRuntimeHooks: () => ({ applyFilter: async (_hook: string, value: unknown) => value }),
}));
import {
  getContentTypeSettings,
  getContentTypeSettingsMap,
  updateContentType,
} from "../../../src/lib/content/content-types-db.js";
import { getSearchSettings } from "../../../src/lib/search/search-db.js";
import { insertHistoricalSnapshot } from "../../../src/lib/content/content-revisions.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue([]);
  mocks.purge.mockResolvedValue(undefined);
  mocks.clear.mockResolvedValue(undefined);
});

describe("stored type settings", () => {
  it.each([
    {},
    JSON.stringify({ preview: false }),
    Buffer.from(JSON.stringify({ preview: false })),
  ])("parses settings returned by database drivers", async (raw) => {
    mocks.query.mockResolvedValue([{ settings: raw }]);
    expect((await getContentTypeSettings("site-a", "post")).preview).toBe(
      typeof raw === "string" || Buffer.isBuffer(raw) ? false : true,
    );
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("site_id = ? AND slug = ?"), [
      "site-a",
      "post",
    ]);
  });
  it("loads settings for many types in one site-scoped query", async () => {
    mocks.query.mockResolvedValue(
      Array.from({ length: 100 }, (_, i) => ({ slug: `type-${i}`, settings: { search: false } })),
    );
    const types = await getContentTypeSettingsMap("site-a");
    expect(types.size).toBe(100);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("WHERE site_id = ?"), [
      "site-a",
    ]);
  });
  it("applies public-search overrides without changing site defaults or private-type exclusions", async () => {
    mocks.query.mockResolvedValue([
      { slug: "post", settings: { search: false } },
      { slug: "product", settings: { search: true } },
      { slug: "account", settings: { search: true } },
    ]);
    expect((await getSearchSettings("site-a")).publicTypes).toEqual(["page", "product"]);
  });
  it("skips historical inserts when revision capture is off", async () => {
    mocks.query.mockResolvedValue([{ settings: { revisions: false } }]);
    expect(
      await insertHistoricalSnapshot({ site_id: "site-a", type: "post", id: "entry" }, "author"),
    ).toBeNull();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("validates and saves settings with tenant isolation and cache invalidation", async () => {
    mocks.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("type = 'auth'"))
        return ["login", "register", "forgot-password", "reset-password"].map((slug) => ({ slug }));
      if (sql.startsWith("SELECT slug"))
        return ["page", "post", "account", "auth"].map((slug) => ({ slug }));
      if (sql.startsWith("SELECT * FROM content_types"))
        return [{ id: "type", site_id: params[0], slug: params[1], fields: [], is_builtin: 1 }];
      return [{ id: "account-page" }];
    });
    const settings = resolveContentTypeSettings("post", { preview: false, comments: "disabled" });
    await updateContentType("site-a", "post", { settings });
    expect(mocks.run).toHaveBeenCalledWith(expect.stringContaining("settings = ?"), [
      JSON.stringify(settings),
      expect.any(String),
      "site-a",
      "post",
    ]);
    expect(mocks.clear).toHaveBeenCalledWith(["pages", "content"]);
    expect(mocks.purge).toHaveBeenCalledWith({ siteId: "site-a" });
  });
});
