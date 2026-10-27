// SPDX-License-Identifier: MIT
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";
process.env.STATE = "INSTALLED";

const SITE = "site-1";
let role = "administrator";
const queries: { sql: string; params: unknown[] }[] = [];
const fakeDb = {
  async query(sql: string, params: unknown[] = []) {
    queries.push({ sql, params });
    return [
      { id: "z-new", type: "page", updated_at: "2026-10-14" },
      { id: "a-old", type: "page", updated_at: "2026-09-01" },
    ];
  },
  async run() {}, async close() {},
};
vi.mock("../../../../src/lib/auth/access-policy.js", () => ({
  getEffectiveAccess: async () => ({ capabilities: ["content:read"], policy: { scopes: {} } }),
  userCan: async () => true,
}));
vi.mock("../../../../src/lib/database/db.js", () => ({ getDb: async () => fakeDb, resetDb: () => {} }));
vi.mock("../../../../src/middleware/auth.js", () => ({
  requireCapability:
    () =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requireRole:
    (...roles: string[]) =>
    (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (roles.includes(role)) return next();
      res.status(403).json({ error: "forbidden" });
    },
  requireSession: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock("../../../../src/lib/content/content-public.js", () => ({
  invalidateContentCache: async () => {},
  invalidateContentCacheForSlug: async () => {},
  overlayWorkingOnRow: (r: unknown) => r,
}));
vi.mock("../../../../src/lib/cache/cache-revalidate.js", () => ({ revalidateOnUpdate: async () => {} }));
vi.mock("../../../../src/lib/plugins/plugin-runtime.js", () => ({
  getRuntimeHooks: () => ({
    dispatchAction: async () => {},
    dispatchGate: async () => {},
    applyFilter: async (_n: string, v: unknown) => v,
    has: () => false,
  }),
  ensurePluginRuntime: async () => {},
  getPluginLoader: () => null,
}));

const { default: contentRoutes } = await import("../../../../src/routes/content/content.js");

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: unknown }).session = { siteId: SITE, userId: "user-1", role };
    next();
  });
  app.use("/api/content", contentRoutes);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(() => r(null))));


it("uses a site-scoped date/id cursor for newest-first pages in one query", async () => {
  queries.length = 0;
  const res = await fetch(`${base}/api/content?type=page&limit=1&cursor=z-new`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.items).toHaveLength(1);
  expect(body.nextCursor).toBe("z-new");
  expect(queries).toHaveLength(1);
  expect(queries[0]!.sql).toContain("ORDER BY c.updated_at DESC, c.id DESC");
  expect(queries[0]!.sql).toContain("c.updated_at < (SELECT updated_at FROM content WHERE site_id = ? AND id = ?)");
  expect(queries[0]!.sql).toContain("AND c.id < ?");
  expect(queries[0]!.params).toEqual([SITE, "page", SITE, "z-new", SITE, "z-new", "z-new", 2]);
});
it("preserves the ascending id cursor for scheduled content", async () => {
  queries.length = 0;
  const res = await fetch(`${base}/api/content?status=scheduled&cursor=a-old`);
  expect(res.status).toBe(200);
  expect(queries[0]!.sql).toContain("AND c.id > ?");
  expect(queries[0]!.sql).toContain("ORDER BY c.id ASC");
  expect(queries[0]!.params).toEqual([SITE, "a-old", 21]);
});
