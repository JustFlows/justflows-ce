// SPDX-License-Identifier: MIT
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";
process.env.DB_DRIVER = "postgres";

let allow = true;
const createContentEntry = vi.fn(async () => ({ status: 201, body: { id: "c-new" } }));

vi.mock("../../lib/api-keys.js", () => ({
  keyCan: async () => allow,
}));
vi.mock("../../lib/db.js", () => ({
  getDb: async () => ({
    query: async () => [
      { id: "c1", type: "post", title: "One", slug: "one", locale: "en", status: "published", version: 1 },
      { id: "c2", type: "post", title: "Two", slug: "two", locale: "en", status: "draft", version: 1 },
    ],
    run: async () => undefined,
  }),
}));
vi.mock("../../lib/access-policy.js", () => ({
  getEffectiveAccess: async () => ({ roleId: "administrator", capabilities: [], policy: { scopes: {} } }),
}));
vi.mock("../../lib/i18n/languages-db.js", () => ({
  resolveContentLocale: async (l: string) => l,
}));
vi.mock("../../lib/content-write.js", async (orig) => ({
  ...(await orig<typeof import("../../lib/content-write.js")>()),
  createContentEntry: (...args: unknown[]) => createContentEntry(...(args as [])),
}));

const { default: router } = await import("../manage-api/content.js");

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/manage/v1/content",
    (req, _res, next) => {
      req.apiKey = {
        id: "key-1",
        scope: {},
        allowedIps: [],
        allowedOrigins: [],
      } as never;
      req.apiKeyOwner = { userId: "u1", siteId: "s1", role: "administrator" };
      next();
    },
    router,
  );
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/manage/v1/content`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  allow = true;
  createContentEntry.mockClear();
});

describe("GET /api/manage/v1/content", () => {
  it("returns a cursor-paginated envelope within the key's scope", async () => {
    const res = await fetch(base);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; page: { total: number; nextCursor: unknown } };
    expect(body.data).toHaveLength(2);
    expect(body.page.total).toBe(2);
    expect(res.headers.get("etag")).toBeTruthy();
  });

  it("answers 304 when If-None-Match matches", async () => {
    const first = await fetch(base);
    const etag = first.headers.get("etag")!;
    const second = await fetch(base, { headers: { "if-none-match": etag } });
    expect(second.status).toBe(304);
  });

  it("is 403 Forbidden when the key is out of scope", async () => {
    allow = false;
    const res = await fetch(base);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });
});

describe("POST /api/manage/v1/content", () => {
  it("relays the shared service result", async () => {
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "post", title: "Hello" }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "c-new" });
    expect(createContentEntry).toHaveBeenCalledOnce();
  });

  it("is 403 when the key lacks content:create", async () => {
    allow = false;
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "post", title: "Hello" }),
    });
    expect(res.status).toBe(403);
    expect(createContentEntry).not.toHaveBeenCalled();
  });
});
