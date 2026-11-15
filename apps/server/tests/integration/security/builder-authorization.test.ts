// SPDX-License-Identifier: MIT
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Builder 2.0 authorization matrix (justflows-ce#309).
 *
 * Every route that changes or reveals a site-wide design document (templates,
 * template parts, the header library, widget areas, menus, patterns, reusable
 * blocks, style presets, global styles and document history) is called as
 * each role, with the real role check. Roles below the allowed ones get 403,
 * no session gets 401, and neither reaches storage. Administrators pass the
 * check, so an always-deny implementation cannot satisfy the test.
 */

const state = vi.hoisted(() => ({
  role: null as string | null,
  dbCalls: 0,
  settingWrites: 0,
  /** Capabilities of the custom role `custom-role`, stored as a site role (justflows-ce#314). */
  customCapabilities: [] as string[],
}));

vi.mock("../../../src/lib/auth/auth-session.js", () => ({
  resolveSession: async () => (state.role ? { siteId: "s1", userId: "u1", role: state.role, email: "u@example.test" } : null),
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
vi.mock("../../../src/lib/database/db.js", () => {
  /** Reading who the user is and what their role allows is the check itself, not storage. */
  const ACCESS_LOOKUP = /\b(user_access_policies|user_additional_roles|access_roles)\b/;
  const touch = async (sql: string) => {
    if (typeof sql === "string" && ACCESS_LOOKUP.test(sql)) {
      if (/FROM user_access_policies/.test(sql) && state.role === "custom-role") {
        return [{ role_id: "custom-role", grants_json: "[]", denies_json: "[]", scopes_json: "{}", capabilities_json: JSON.stringify(state.customCapabilities) }];
      }
      return [];
    }
    state.dbCalls++;
    return [];
  };
  return { getDb: async () => ({ query: touch, run: touch, transaction: async (fn: (db: unknown) => unknown) => fn({ query: touch, run: touch }) }) };
});
vi.mock("../../../src/lib/settings/site-settings.js", async (original) => ({
  ...(await original<typeof import("../../../src/lib/settings/site-settings.js")>()),
  getSiteId: async () => "s1",
  getSiteSetting: async () => null,
  setSiteSetting: async () => {
    state.settingWrites++;
  },
}));
/** A role outside the built-in list falls back to the site's default role, read from settings; the stored role is what matters here. */
vi.mock("../../../src/lib/auth/plugin-role-fallback.js", () => ({ effectivePrimaryRole: async (_site: string, role: string) => role }));
vi.mock("../../../src/lib/security/audit-log.js", async (original) => ({
  ...(await original<typeof import("../../../src/lib/security/audit-log.js")>()),
  auditFromRequest: vi.fn(),
  auditLog: vi.fn(async () => {}),
}));

const reusable = await import("../../../src/routes/content/reusable-blocks.js");
const mounts: Array<[string, express.Router]> = [
  ["/api/reusable-blocks", reusable.default],
  ["/api/template-parts", reusable.templatePartsRouter],
  ["/api/templates", (await import("../../../src/routes/design/templates.js")).default],
  ["/api/headers", (await import("../../../src/routes/design/site-header.js")).default],
  ["/api/widgets", (await import("../../../src/routes/design/widgets.js")).default],
  ["/api/menus", (await import("../../../src/routes/design/menus.js")).default],
  ["/api/patterns", (await import("../../../src/routes/design/patterns.js")).default],
  ["/api/style-presets", (await import("../../../src/routes/design/style-presets.js")).default],
  ["/api/document-history", (await import("../../../src/routes/design/document-history.js")).default],
  ["/api/themes", (await import("../../../src/routes/design/themes.js")).default],
];

let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  for (const [path, router] of mounts) app.use(path, router);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  state.dbCalls = 0;
  state.settingWrites = 0;
  state.customCapabilities = [];
});

const call = (method: string, path: string, body: unknown = {}) =>
  fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });

/** Routes for administrators and editors only. */
const DESIGN_ROUTES: Array<[string, string]> = [
  ["PUT", "/api/reusable-blocks"],
  ["POST", "/api/reusable-blocks/cta/publish"],
  ["POST", "/api/reusable-blocks/cta/discard"],
  ["PATCH", "/api/reusable-blocks/cta"],
  ["POST", "/api/reusable-blocks/cta/duplicate"],
  ["DELETE", "/api/reusable-blocks/cta"],
  ["PUT", "/api/template-parts/footer"],
  ["PUT", "/api/templates/page"],
  ["POST", "/api/templates/page/discard-draft"],
  ["DELETE", "/api/templates/page"],
  ["PUT", "/api/headers"],
  ["PUT", "/api/widgets/layout"],
  ["POST", "/api/widgets/areas"],
  ["PUT", "/api/widgets/areas/sidebar"],
  ["DELETE", "/api/widgets/areas/sidebar"],
  ["DELETE", "/api/widgets/areas/sidebar/draft"],
  ["PUT", "/api/menus/main"],
  ["POST", "/api/menus"],
  ["DELETE", "/api/menus/main"],
  ["PUT", "/api/patterns"],
  ["POST", "/api/patterns/import"],
  ["DELETE", "/api/patterns/hero"],
  ["GET", "/api/patterns/export"],
  ["PUT", "/api/style-presets"],
  ["DELETE", "/api/style-presets/card"],
  ["POST", "/api/style-presets/publish"],
  ["POST", "/api/style-presets/discard"],
  ["GET", "/api/document-history?kind=template_part&key=footer"],
  ["GET", "/api/document-history/h1?kind=template_part&key=footer"],
  ["PATCH", "/api/themes/customize"],
  ["DELETE", "/api/themes/customize"],
];

describe.each(DESIGN_ROUTES)("%s %s", (method, path) => {
  it.each(["author", "contributor", "subscriber", "custom-role"])("is refused for %s, without touching storage", async (role) => {
    state.role = role;
    const res = await call(method, path);
    expect(res.status).toBe(403);
    expect(state.dbCalls).toBe(0);
    expect(state.settingWrites).toBe(0);
  });

  it("is refused without a session", async () => {
    state.role = null;
    expect((await call(method, path)).status).toBe(401);
    expect(state.dbCalls + state.settingWrites).toBe(0);
  });

  it("lets an administrator past the check", async () => {
    state.role = "administrator";
    expect([401, 403]).not.toContain((await call(method, path)).status);
  });
});

/**
 * Design capabilities for custom roles (justflows-ce#314): a custom role
 * with design:manage passes every design write check, and one without it is
 * refused before storage, whatever else it may do.
 */
describe("custom roles and the design capabilities", () => {
  it.each(DESIGN_ROUTES)("%s %s is refused for a custom role without design:manage, without touching storage", async (method, path) => {
    state.role = "custom-role";
    state.customCapabilities = ["content:read", "content:create", "content:update", "content:publish", "settings:manage", "design:read"];
    expect((await call(method, path)).status).toBe(403);
    expect(state.dbCalls).toBe(0);
    expect(state.settingWrites).toBe(0);
  });

  it.each(DESIGN_ROUTES)("%s %s lets a custom role with design:manage past the check", async (method, path) => {
    state.role = "custom-role";
    state.customCapabilities = ["content:read", "design:read", "design:manage"];
    expect([401, 403]).not.toContain((await call(method, path)).status);
  });

  it("lets a custom role with design:read open the design lists, and refuses one without it", async () => {
    state.role = "custom-role";
    state.customCapabilities = ["design:read"];
    for (const path of ["/api/menus", "/api/headers", "/api/style-presets", "/api/patterns", "/api/widgets"]) {
      expect([401, 403], path).not.toContain((await call("GET", path)).status);
    }
    state.customCapabilities = ["content:read"];
    for (const path of ["/api/menus", "/api/headers", "/api/style-presets", "/api/patterns", "/api/widgets"]) {
      expect((await call("GET", path)).status, path).toBe(403);
    }
  });
});
