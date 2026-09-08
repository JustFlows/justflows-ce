// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PERMALINK_SETTINGS } from "../permalinks.js";
const id = "bd922cab-6845-4035-bbdb-4fabbe06f87a";
const rows: Array<{ id: string; rule: string }> = [];
const run = vi.fn(async (_sql: string, _params: unknown[] = []) => {});
const query = vi.fn(async (sql: string) => {
  if (sql.includes("FROM redirects")) return rows;
  if (sql.includes("SELECT url")) return [{ url: "https://example.test" }];
  if (sql.includes("COUNT(*)")) return [{ total: 0 }];
  return [{ id: "site" }];
});
const execute = vi.fn(async () => 0);
const tx = { query, run, execute };
const transaction = vi.fn(async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx));
const invalidate = vi.fn();
const state = { settings: DEFAULT_PERMALINK_SETTINGS, redirects: {} as Record<string, string> };
vi.mock("../db.js", () => ({ getDb: async () => ({ ...tx, transaction }) }));
vi.mock("../jf-cache.js", () => ({
  getJfCache: () => ({
    invalidate,
    remember: (_key: string, _ttl: number, fn: () => unknown) => fn(),
  }),
}));
vi.mock("../permalinks-db.js", () => ({
  getPermalinkState: async () => state,
  permalinkContent: async () => [
    { id, slug: "current", title: "Current", locale: "en-US", type: "page", status: "published" },
  ],
  reservedPermalinkPath: async (path: string) => path.startsWith("/api"),
  listPermalinkTerms: async () => [],
}));
vi.mock("../home-page.js", () => ({ getHomeContent: async () => null }));
vi.mock("../i18n/languages-db.js", () => ({
  getActiveLocaleCodes: async () => ["en-US", "nl-NL"],
  getDefaultLocale: async () => "en-US",
}));
const {
  saveRedirects,
  recordNotFound,
  redirectContext,
  canonicalRedirectTarget,
  materializeRedirects,
  withRedirectHistory,
} = await import("../redirects-db.js");
const input = {
  source: "/old",
  kind: "exact" as const,
  targetType: "internal" as const,
  target: "/new",
  status: 301 as const,
  enabled: true,
};
beforeEach(() => {
  rows.length = 0;
  state.redirects = {};
  vi.clearAllMocks();
  execute.mockResolvedValue(0);
});
describe("redirect persistence", () => {
  it("locks the site and validates an entire import before writing", async () => {
    await expect(
      saveRedirects("site", [input, { ...input, source: "/new", target: "/old" }]),
    ).rejects.toThrow(/loop/);
    expect(query).toHaveBeenCalledWith("SELECT id FROM sites WHERE id = ? FOR UPDATE", ["site"]);
    expect(run).not.toHaveBeenCalled();
    await expect(saveRedirects("site", [input, input])).rejects.toThrow(/already exists/);
    expect(run).not.toHaveBeenCalled();
  });
  it("stores site-scoped rules and invalidates cached rules and pages", async () => {
    const saved = await saveRedirects("site", [input]);
    expect(saved).toHaveLength(1);
    expect(run).toHaveBeenCalledWith("INSERT INTO redirects (id, site_id, rule) VALUES (?, ?, ?)", [
      expect.any(String),
      "site",
      JSON.stringify(input),
    ]);
    expect(invalidate).toHaveBeenCalledWith("redirects:site");
    expect(invalidate).toHaveBeenCalledWith("page:");
  });
  it("rejects cross-site edits, reserved sources, and unavailable content targets", async () => {
    await expect(saveRedirects("site", [input], id)).rejects.toThrow(/not found/);
    await expect(saveRedirects("site", [{ ...input, source: "/api/private" }])).rejects.toThrow(
      /platform/,
    );
    await expect(
      saveRedirects("site", [
        { ...input, targetType: "content", target: "acd66526-58cc-48ef-a508-80b0b2b522f4" },
      ]),
    ).rejects.toThrow(/published/);
    expect(run).not.toHaveBeenCalled();
  });
  it("can disable rules after their content target becomes unavailable", async () => {
    const unavailable = {
      ...input,
      enabled: false,
      targetType: "content" as const,
      target: "acd66526-58cc-48ef-a508-80b0b2b522f4",
    };
    rows.push({ id, rule: JSON.stringify({ ...unavailable, enabled: true }) });
    await expect(saveRedirects("site", [unavailable], id)).resolves.toHaveLength(1);
  });
  it("rejects loops through history, content identities, canonical paths and own-origin URLs", async () => {
    state.redirects["/previous"] = id;
    for (const rule of [
      { ...input, source: "/current", target: "/previous" },
      { ...input, source: "/current", target: "/previous/" },
      { ...input, source: "/current", targetType: "content" as const, target: id },
      { ...input, source: "/current", target: "/en-US/current/" },
      {
        ...input,
        source: "/current",
        targetType: "external" as const,
        target: "https://example.test/current/",
      },
    ])
      await expect(saveRedirects("site", [rule])).rejects.toThrow(/loop/);
    expect(run).not.toHaveBeenCalled();
  });
  it("preserves explicit query and fragment data when collapsing canonical destinations", async () => {
    const context = await redirectContext("site");
    expect(canonicalRedirectTarget("/EN-us/current/?source=mail#intro", context)).toBe(
      "/current?source=mail#intro",
    );
    expect(
      materializeRedirects(
        [{ ...input, id: "rule", targetType: "content", target: id }],
        context,
      )[0]?.target,
    ).toBe("/current");
  });
  it("resolves legacy slugs and paginated historical aliases without another browser hop", async () => {
    const context = await redirectContext("site");
    context.legacy = [{ source: "/legacy", target: "/current" }];
    context.history = [{ ...input, id: "history:/prior", source: "/prior", target: "/current" }];
    expect(canonicalRedirectTarget("/legacy/", context)).toBe("/current");
    expect(canonicalRedirectTarget("/prior/page/2/", context)).toBe("/current/page/2");
  });
  it("restores automatic history when a managed override is disabled", () => {
    const history = [{ ...input, id: "history:/old" }];
    expect(withRedirectHistory([{ ...input, id, enabled: false }], history)).toHaveLength(2);
    expect(withRedirectHistory([{ ...input, id }], history)).toHaveLength(1);
  });
});
describe("404 aggregation", () => {
  it("counts existing paths atomically and strips sensitive referrer data", async () => {
    execute.mockResolvedValueOnce(1);
    await recordNotFound(
      "site",
      "/missing",
      "https://user:password@example.test/source?token=secret#private",
    );
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("hits = hits + 1"), [
      "https://example.test/source",
      "site",
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ]);
    expect(run.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(false);
  });
  it("caps distinct paths and prunes old entries", async () => {
    query.mockImplementationOnce(async () => [{ id: "site" }]);
    query.mockImplementationOnce(async () => [{ total: 10000 }]);
    await recordNotFound("site", "/missing", "");
    expect(run).toHaveBeenCalledWith(expect.stringContaining("last_seen < ?"), [
      "site",
      expect.any(String),
    ]);
    expect(run.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(false);
  });
  it("rejects unsafe paths and avoids storing query strings", async () => {
    for (const path of ["//evil", "/missing?token=secret", "/a#fragment", "/%0a"])
      await recordNotFound("site", path, "");
    expect(transaction).not.toHaveBeenCalled();
  });
});
