// SPDX-License-Identifier: MIT
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";
process.env.DB_DRIVER = "postgres";
delete process.env.APP_URL;

const env = vi.hoisted(() => ({
  enabled: true,
  limit: 1000,
  ownerCaps: ["content:read", "content:create", "content:update", "content:delete", "content:publish"],
  keyCaps: ["content:read"],
  userTools: false,
}));

vi.mock("../../../../src/lib/ai/ai-settings.js", async (orig) => ({
  ...(await orig<typeof import("../../../../src/lib/ai/ai-settings.js")>()),
  isMcpEnabled: async () => env.enabled,
  getMcpRateLimit: async () => env.limit,
}));
vi.mock("../../../../src/lib/auth/access-policy.js", async (orig) => ({
  ...(await orig<typeof import("../../../../src/lib/auth/access-policy.js")>()),
  getEffectiveAccess: async () => ({ roleId: "editor", capabilities: env.ownerCaps, policy: { scopes: {} } }),
}));
vi.mock("../../../../src/lib/auth/api-keys.js", async (orig) => {
  const actual = await orig<typeof import("../../../../src/lib/auth/api-keys.js")>();
  return {
    ...actual,
    verifyApiKey: async (secret: string) =>
      secret === "jfk_good"
        ? {
            record: {
              id: "key-1", siteId: "s1", name: "Cursor", keyPrefix: "jfk_good", ownerUserId: "u1", createdBy: "u1",
              capabilities: env.keyCaps, scope: {}, allowedIps: [], allowedOrigins: [], rateLimitPerMin: null,
              mcpUserTools: env.userTools, expiresAt: null, revokedAt: null, lastUsedAt: null, lastUsedIp: null,
              requestCount: 0, createdAt: "", updatedAt: "",
            },
            owner: { userId: "u1", siteId: "s1", role: "editor" },
            rejection: null,
          }
        : null,
    recordApiKeyUse: async () => {},
  };
});
vi.mock("../../../../src/lib/database/db.js", () => ({
  getDb: async () => ({
    query: async (sql: string) =>
      /FROM content c/.test(sql)
        ? [{ id: "c1", type: "post", title: "Hello", slug: "hello", locale: "en-US", status: "draft", version: 1 }]
        : [],
    run: async () => undefined,
    execute: async () => 0,
  }),
}));
vi.mock("../../../../src/lib/i18n/languages-db.js", async (orig) => ({
  ...(await orig<typeof import("../../../../src/lib/i18n/languages-db.js")>()),
  resolveContentLocale: async (l: string) => l,
}));
const audit = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../../../src/lib/security/audit-log.js", async (orig) => ({
  ...(await orig<typeof import("../../../../src/lib/security/audit-log.js")>()),
  auditLog: audit,
}));

const { default: mcpRouter } = await import("../../../../src/routes/ai/mcp.js");
const { csrfProtection } = await import("../../../../src/middleware/csrf.js");

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // The real middleware order: CSRF guards all of /api before any route.
  app.use("/api", csrfProtection);
  app.use("/api/mcp", mcpRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  env.enabled = true;
  env.limit = 1000;
  env.keyCaps = ["content:read"];
  env.userTools = false;
});

let nextId = 1;
async function rpc(method: string, params: unknown = {}, token = "jfk_good") {
  const res = await fetch(base, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  const text = await res.text();
  return { res, body: text ? (JSON.parse(text) as { result?: Record<string, unknown>; error?: unknown }) : null };
}

describe("/api/mcp", () => {
  it("answers 404 while MCP is turned off", async () => {
    env.enabled = false;
    const { res } = await rpc("tools/list");
    expect(res.status).toBe(404);
  });

  it("challenges an unauthenticated request with the protected resource metadata URL", async () => {
    const { res } = await rpc("tools/list", {}, "");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(
      /^Bearer resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource\/api\/mcp"$/,
    );
  });

  it("gives an unknown key the same generic 401, marked invalid_token", async () => {
    const { res, body } = await rpc("tools/list", {}, "jfk_nope");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/error="invalid_token"/);
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("initializes and lists only the tools the key can use", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.res.status).toBe(200);
    expect(init.body?.result).toMatchObject({ serverInfo: { name: "justflows" }, capabilities: { tools: {} } });

    const { body } = await rpc("tools/list");
    const names = (body?.result?.tools as { name: string; annotations: { readOnlyHint: boolean } }[]).map((t) => t.name);
    expect(names).toContain("content_list");
    expect(names).toContain("site_describe");
    expect(names).not.toContain("content_create");
    expect(names).not.toContain("content_delete");
  });

  it("refuses a direct call to a tool missing from tools/list", async () => {
    const { body } = await rpc("tools/call", { name: "content_delete", arguments: { id: "c1" } });
    expect(body?.result).toMatchObject({ isError: true });
    expect(JSON.stringify(body?.result)).toMatch(/not available to this session/);
  });

  it("runs a tool through the real management API router in-process", async () => {
    const { body } = await rpc("tools/call", { name: "content_list", arguments: { type: "post" } });
    expect(body?.result).toMatchObject({ isError: false });
    const text = (body?.result?.content as { text: string }[])[0]!.text;
    expect(JSON.parse(text)).toMatchObject({ data: [{ id: "c1", title: "Hello" }] });
  });

  it("returns tool argument problems as tool errors, not protocol errors", async () => {
    const { body } = await rpc("tools/call", { name: "content_get", arguments: {} });
    expect(body?.error).toBeUndefined();
    expect(body?.result).toMatchObject({ isError: true });
  });

  it("rate-limits per key", async () => {
    env.limit = 2;
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await rpc("tools/list")).res.status);
    expect(statuses).toContain(429);
  });

  it("rejects GET with 405 (stateless server, no standalone stream)", async () => {
    const res = await fetch(base, { headers: { authorization: "Bearer jfk_good", accept: "text/event-stream" } });
    expect(res.status).toBe(405);
  });
});
