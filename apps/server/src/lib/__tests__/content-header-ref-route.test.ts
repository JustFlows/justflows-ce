import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";
process.env.STATE = "INSTALLED";

const SITE = "site-1";
let contentRow: Record<string, unknown>;
let workingRows: Record<string, unknown>[];
const contentUpdates: unknown[][] = [];
const revisionUpdates: unknown[][] = [];
let role = "administrator";

const fakeDb = {
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (/FROM content WHERE id = \? AND site_id = \?/i.test(sql)) {
      return (contentRow ? [contentRow] : []) as unknown as T[];
    }
    if (/FROM revisions/i.test(sql)) return workingRows as unknown as T[];
    return [] as T[];
  },
  async run(sql: string, params: unknown[] = []): Promise<void> {
    if (/UPDATE content SET fields/i.test(sql)) contentUpdates.push(params);
    else if (/UPDATE revisions SET fields/i.test(sql)) revisionUpdates.push(params);
  },
  async close() {},
};

vi.mock("../db.js", () => ({ getDb: async () => fakeDb, resetDb: () => {} }));
vi.mock("../../middleware/auth.js", () => ({
  requireRole:
    (...roles: string[]) =>
    (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (roles.includes(role)) return next();
      res.status(403).json({ error: "forbidden" });
    },
  requireSession: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock("../content-public.js", () => ({
  invalidateContentCache: async () => {},
  invalidateContentCacheForSlug: async () => {},
  overlayWorkingOnRow: (r: unknown) => r,
}));
vi.mock("../cache-revalidate.js", () => ({ revalidateOnUpdate: async () => {} }));
vi.mock("../plugin-runtime.js", () => ({
  getRuntimeHooks: () => ({
    dispatchAction: async () => {},
    dispatchGate: async () => {},
    applyFilter: async (_n: string, v: unknown) => v,
    has: () => false,
  }),
  ensurePluginRuntime: async () => {},
  getPluginLoader: () => null,
}));

const { default: contentRoutes } = await import("../../routes/content.js");

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

beforeEach(() => {
  role = "administrator";
  contentRow = {
    id: "page-1",
    site_id: SITE,
    author_id: "user-1",
    fields: JSON.stringify({ seoTitle: "Home" }),
  };
  workingRows = [];
  contentUpdates.length = 0;
  revisionUpdates.length = 0;
});

async function putRef(ref: string, id = "page-1") {
  const res = await fetch(`${base}/api/content/${id}/header-ref`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref }),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

describe("PUT /api/content/:id/header-ref", () => {
  it("writes the ref into the live row's fields, preserving other keys", async () => {
    const r = await putRef("hdr-2");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, ref: "hdr-2" });
    expect(contentUpdates).toHaveLength(1);
    expect(JSON.parse(String(contentUpdates[0]![0]))).toEqual({ seoTitle: "Home", jfHeaderRef: "hdr-2" });
  });

  it("clears the ref for the site default", async () => {
    contentRow.fields = JSON.stringify({ seoTitle: "Home", jfHeaderRef: "hdr-2" });
    const r = await putRef("__default__");
    expect(r.body).toEqual({ ok: true, ref: "__default__" });
    expect(JSON.parse(String(contentUpdates[0]![0]))).toEqual({ seoTitle: "Home" });
  });

  it("also updates the working revision when one exists", async () => {
    workingRows = [{ id: "rev-1", content_id: "page-1", site_id: SITE, kind: "working", fields: JSON.stringify({ seoTitle: "Home" }), blocks: "[]", title: "Home" }];
    await putRef("hdr-9");
    expect(revisionUpdates).toHaveLength(1);
    expect(JSON.parse(String(revisionUpdates[0]![0])).jfHeaderRef).toBe("hdr-9");
  });

  it("404s for a missing page", async () => {
    contentRow = undefined as never;
    expect((await putRef("hdr-2")).status).toBe(404);
  });

  it("rejects a non-owner without delete-any permission", async () => {
    role = "author";
    contentRow.author_id = "someone-else";
    expect((await putRef("hdr-2")).status).toBe(403);
  });
});
