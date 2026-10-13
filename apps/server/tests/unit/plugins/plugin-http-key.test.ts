// SPDX-License-Identifier: MIT
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PluginHttpRouter } from "@justflows/plugin-api";
import type { PluginHttpRequest } from "@justflows/sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = { userId: "u-1", siteId: "site-1", role: "administrator" };

const mocks = vi.hoisted(() => ({
  router: null as PluginHttpRouter | null,
  key: null as null | Record<string, unknown>,
  rejection: null as null | string,
  ownerCapabilities: [] as string[],
  manageApi: true,
  siteMatches: true,
  seen: [] as Array<PluginHttpRequest["session"]>,
  audits: [] as string[],
  used: [] as string[],
}));

vi.mock("../../../src/lib/plugins/plugin-runtime.js", () => ({
  ensurePluginRuntime: async () => undefined,
  getPluginLoader: () => ({ httpRouter: mocks.router }),
}));
vi.mock("../../../src/lib/auth/auth-session.js", () => ({
  // A signed-in cookie session that must never win over a key.
  resolveSession: async () => ({ userId: "cookie-user", siteId: "site-1", role: "editor", email: "e@example.com" }),
}));
vi.mock("../../../src/lib/i18n/languages-db.js", () => ({ getActiveLocaleCodes: async () => ["en"], getDefaultLocale: async () => "en" }));
vi.mock("../../../src/lib/tenancy/access.js", () => ({ sessionMatchesRequestSite: () => mocks.siteMatches }));
vi.mock("../../../src/lib/http/manage-api-settings.js", () => ({
  isManageApiEnabled: async () => mocks.manageApi,
  getManageApiRateLimit: async () => 2,
}));
vi.mock("../../../src/lib/security/audit-log.js", () => ({
  auditLog: async (entry: { action: string }) => {
    mocks.audits.push(entry.action);
  },
}));
vi.mock("../../../src/lib/auth/access-policy.js", () => ({
  availableCapabilityDefinitions: async () => [
    { id: "content:read", pluginId: null },
    { id: "users:manage", pluginId: null },
    { id: "products:update", pluginId: "justflows.shop" },
  ],
  getEffectiveAccess: async (userId: string) => ({
    roleId: "administrator",
    additionalRoles: [],
    roles: ["administrator"],
    capabilities: userId === OWNER.userId ? mocks.ownerCapabilities : ["content:read"],
    policy: { scopes: {} },
  }),
}));
vi.mock("../../../src/lib/auth/api-keys.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/lib/auth/api-keys.js")>()),
  verifyApiKey: async (token: string) =>
    token === "jfk_good" && mocks.key ? { record: mocks.key, owner: OWNER, rejection: mocks.rejection } : null,
  recordApiKeyUse: async (id: string) => {
    mocks.used.push(id);
  },
}));

import { dispatchPluginHttp } from "../../../src/lib/plugins/plugin-http.js";

function key(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `key-${Math.random().toString(36).slice(2)}`,
    capabilities: ["content:read", "site:admin"],
    scope: {},
    allowedIps: [],
    allowedOrigins: [],
    rateLimitPerMin: 100,
    ...overrides,
  };
}

let server: Server;
let base: string;
beforeAll(async () => {
  const router = new PluginHttpRouter();
  mocks.router = router;
  const handler = async (req: PluginHttpRequest) => {
    mocks.seen.push(req.session);
    return { body: { ok: true, authorization: req.headers["authorization"] ?? null } };
  };
  router.register("justflows.shop", "GET", "catalog", handler);
  router.register("justflows.shop", "PUT", "catalog/:id", handler);
  const app = express();
  app.use(express.json());
  app.use(dispatchPluginHttp);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))));

beforeEach(() => {
  mocks.key = key();
  mocks.rejection = null;
  mocks.ownerCapabilities = ["content:read", "site:admin", "products:update"];
  mocks.manageApi = true;
  mocks.siteMatches = true;
  mocks.seen = [];
  mocks.audits = [];
  mocks.used = [];
});

const put = (token: string | null) =>
  fetch(`${base}/ext/justflows.shop/catalog/abc`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: "{}",
  });

describe("management API keys on plugin routes", () => {
  it("gives a site:admin key the plugin capabilities its owner has, without CSRF", async () => {
    const res = await put("jfk_good");
    expect(res.status).toBe(200);
    expect((await res.json()).authorization).toBeNull();
    expect(mocks.seen[0]).toMatchObject({ userId: "u-1", siteId: "site-1", role: "api-key" });
    expect(mocks.seen[0]?.capabilities).toEqual(["content:read", "site:admin", "products:update"]);
    expect(mocks.used).toEqual([mocks.key!["id"]]);
  });

  it("never widens site:admin to core capabilities the key lacks", async () => {
    mocks.ownerCapabilities = ["content:read", "site:admin", "users:manage", "products:update"];
    await put("jfk_good");
    expect(mocks.seen[0]?.capabilities).toEqual(["content:read", "site:admin", "products:update"]);
  });

  it("limits a key without site:admin to its own capabilities the owner still has", async () => {
    mocks.key = key({ capabilities: ["content:read", "users:manage"] });
    await put("jfk_good");
    expect(mocks.seen[0]?.capabilities).toEqual(["content:read"]);
  });

  it("never gives more than the owner currently has", async () => {
    mocks.ownerCapabilities = ["content:read"];
    await put("jfk_good");
    expect(mocks.seen[0]?.capabilities).toEqual(["content:read"]);
  });

  it.each([
    ["an unknown key", () => undefined, "jfk_bad"],
    ["a revoked key", () => { mocks.rejection = "revoked"; }, "jfk_good"],
    ["a scoped key", () => { mocks.key = key({ scope: { contentTypes: ["post"] } }); }, "jfk_good"],
    ["a key from another site", () => { mocks.siteMatches = false; }, "jfk_good"],
    ["a disallowed IP", () => { mocks.key = key({ allowedIps: ["10.0.0.1"] }); }, "jfk_good"],
    ["the Manage API switched off", () => { mocks.manageApi = false; }, "jfk_good"],
  ])("refuses %s with 401 and never reaches the plugin", async (_name, arrange, token) => {
    arrange();
    const res = await put(token);
    expect(res.status).toBe(401);
    expect(mocks.seen).toHaveLength(0);
  });

  it("audits a refused key", async () => {
    mocks.rejection = "expired";
    await put("jfk_good");
    expect(mocks.audits).toEqual(["apikey.auth_failed"]);
  });

  it("keeps CSRF on cookie requests", async () => {
    expect((await put(null)).status).toBe(403);
    expect(mocks.seen).toHaveLength(0);
    const read = await fetch(`${base}/ext/justflows.shop/catalog`);
    expect(read.status).toBe(200);
    expect(mocks.seen[0]).toMatchObject({ userId: "cookie-user", role: "editor" });
  });

  it("does not treat another bearer token as a key", async () => {
    await put("jfo_at_something");
    expect(mocks.used).toHaveLength(0);
    expect(mocks.seen[0]?.role).not.toBe("api-key");
  });

  it("applies the key's rate limit", async () => {
    mocks.key = key({ rateLimitPerMin: 1 });
    expect((await put("jfk_good")).status).toBe(200);
    expect((await put("jfk_good")).status).toBe(429);
    expect(mocks.seen).toHaveLength(1);
  });
});
