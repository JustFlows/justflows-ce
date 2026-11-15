// SPDX-License-Identifier: MIT
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Safe error messages on design routes (justflows-ce#315).
 *
 * Every save on a site-wide design document is called while the database
 * fails with a driver message naming the host and a column. The answer must
 * be a generic 500 without that text, on the admin routes and on the
 * management API. Input the caller can fix still gets a 400 that says what
 * is wrong.
 */

const state = vi.hoisted(() => ({ dbFails: false }));

vi.mock("../../../src/lib/auth/auth-session.js", () => ({
  resolveSession: async () => ({ siteId: "s1", userId: "u1", role: "administrator", email: "u@example.test" }),
  isPreviewAllowed: async () => false,
}));
vi.mock("../../../src/lib/auth/session.js", async (original) => ({
  ...(await original<typeof import("../../../src/lib/auth/session.js")>()),
  syncCsrfCookie: vi.fn(),
}));
vi.mock("../../../src/lib/tenancy/access.js", async (original) => ({
  ...(await original<typeof import("../../../src/lib/tenancy/access.js")>()),
  sessionMatchesRequestSite: () => true,
}));
vi.mock("../../../src/lib/auth/api-keys.js", async (original) => ({
  ...(await original<typeof import("../../../src/lib/auth/api-keys.js")>()),
  keyCan: async () => true,
}));
vi.mock("../../../src/lib/database/db.js", () => {
  const fail = async () => {
    if (state.dbFails) throw new Error("ER_NO_SUCH_TABLE: Table 'jf_prod.site_settings_secret' doesn't exist; host db-internal-7:3306");
    return [];
  };
  const db = { dialect: "mysql", query: fail, run: fail, transaction: async (fn: (tx: unknown) => unknown) => fn(db) };
  return { getDb: async () => db };
});
vi.mock("../../../src/lib/settings/site-settings.js", async (original) => ({
  ...(await original<typeof import("../../../src/lib/settings/site-settings.js")>()),
  getSiteId: async () => "s1",
}));
vi.mock("../../../src/lib/themes/themes-db.js", async (original) => ({
  ...(await original<typeof import("../../../src/lib/themes/themes-db.js")>()),
  getSiteId: async () => "s1",
}));
vi.mock("../../../src/lib/security/audit-log.js", async (original) => ({
  ...(await original<typeof import("../../../src/lib/security/audit-log.js")>()),
  auditFromRequest: vi.fn(),
  auditLog: vi.fn(async () => {}),
}));
vi.mock("../../../src/lib/cache/cache-revalidate.js", () => ({ revalidateOnUpdate: async () => {} }));

const reusable = await import("../../../src/routes/content/reusable-blocks.js");
const mounts: Array<[string, express.Router]> = [
  ["/api/reusable-blocks", reusable.default],
  ["/api/template-parts", reusable.templatePartsRouter],
  ["/api/templates", (await import("../../../src/routes/design/templates.js")).default],
  ["/api/headers", (await import("../../../src/routes/design/site-header.js")).default],
  ["/api/patterns", (await import("../../../src/routes/design/patterns.js")).default],
  ["/api/style-presets", (await import("../../../src/routes/design/style-presets.js")).default],
  ["/api/themes", (await import("../../../src/routes/design/themes.js")).default],
  ["/api/css-providers", (await import("../../../src/routes/design/css-providers.js")).default],
];
const manageRouter = (await import("../../../src/routes/manage-api/design.js")).default;

let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  for (const [path, router] of mounts) app.use(path, router);
  app.use("/api/manage/v1", (req, _res, next) => {
    req.apiKey = { id: "key-1", scope: {}, capabilities: [] } as never;
    req.apiKeyOwner = { userId: "u1", siteId: "s1", role: "administrator" };
    next();
  }, manageRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  state.dbFails = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const call = (method: string, path: string, body: unknown = {}) =>
  fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const pattern = { id: "hero", title: "Hero", blocks: [{ id: "p1", type: "core.paragraph", version: 1, props: { text: "Hi" } }] };

/** One valid save per design route, so the request reaches storage. */
const SAVES: Array<[string, string, unknown]> = [
  ["PUT", "/api/reusable-blocks", { name: "CTA", blocks: [] }],
  ["PUT", "/api/template-parts/footer", { blocks: [] }],
  ["PUT", "/api/templates/page", { blocks: [] }],
  ["PUT", "/api/headers", { library: { version: 1, entries: [] } }],
  ["PUT", "/api/patterns", pattern],
  ["POST", "/api/patterns/import", { schemaVersion: 1, patterns: [pattern] }],
  ["PUT", "/api/style-presets", { id: "card", name: "Card", style: {} }],
  ["PATCH", "/api/themes/customize", { mods: {} }],
  ["DELETE", "/api/css-providers/acme.tailwind", {}],
  ["PUT", "/api/manage/v1/headers", { library: { version: 1, entries: [] } }],
  ["PUT", "/api/manage/v1/template-parts/footer", { blocks: [] }],
  ["PUT", "/api/manage/v1/templates/page", { blocks: [] }],
  ["PATCH", "/api/manage/v1/themes/customize", { mods: {} }],
  ["PUT", "/api/manage/v1/reusable-blocks", { name: "CTA", blocks: [] }],
  ["PUT", "/api/manage/v1/style-presets", { id: "card", name: "Card", style: {} }],
  ["PUT", "/api/manage/v1/patterns", pattern],
  ["POST", "/api/manage/v1/patterns/import", { schemaVersion: 1, patterns: [pattern] }],
];

describe.each(SAVES)("%s %s", (method, path, body) => {
  it("answers a database failure with a generic message", async () => {
    state.dbFails = true;
    const res = await call(method, path, body);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: "Internal server error" });
    expect(text).not.toMatch(/ER_NO_SUCH_TABLE|db-internal|site_settings_secret|jf_prod/);
  });
});

describe("input the caller can fix", () => {
  it("names each problem in a pattern import instead of returning Zod's issue list", async () => {
    const res = await call("POST", "/api/patterns/import", { schemaVersion: 1, patterns: [{ id: "a", blocks: [] }] });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toMatch(/^patterns\.0\.title: /);
    expect(error).not.toContain("[");
  });

  it("names the field in the management API's pattern import too", async () => {
    const res = await call("POST", "/api/manage/v1/patterns/import", { schemaVersion: 1, patterns: [{ id: "a", blocks: [] }] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/^patterns\.0\./);
  });

  it("refuses deleting the default CSS provider with a readable reason", async () => {
    const res = await call("DELETE", "/api/css-providers/justflows.none");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "The default CSS provider cannot be deleted" });
  });
});
