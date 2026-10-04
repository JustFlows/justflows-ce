// SPDX-License-Identifier: MIT

import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const settings = new Map<string, unknown>();
const upstreamCalls: string[] = [];

vi.mock("../../../../src/middleware/auth.js", () => ({
  requireRole: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { session: { siteId: string; userId: string; role: string } }).session = {
      siteId: "site-1",
      userId: "user-1",
      role: "administrator",
    };
    next();
  },
}));
vi.mock("../../../../src/lib/settings/site-settings.js", () => ({
  getSiteId: async () => "site-1",
  getSiteSetting: async (_siteId: string, key: string) => settings.get(key) ?? null,
  setSiteSetting: async (_siteId: string, key: string, value: unknown) => {
    settings.set(key, value);
  },
}));
vi.mock("../../../../src/lib/security/audit-log.js", () => ({
  auditFromRequest: () => undefined,
  auditLog: async () => undefined,
}));
vi.mock("../../../../src/lib/plugins/plugins-db.js", () => ({
  getPlugin: async () => null,
  insertPlugin: async () => {
    throw new Error("must not register a plugin that is not installed");
  },
  markPluginError: async () => undefined,
}));

const realFetch = globalThis.fetch;
vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith("https://api.justflows.com/")) return realFetch(input, init);
  upstreamCalls.push(url);
  return new Response("unavailable", { status: 502 });
});

const { default: marketplaceRoutes } = await import("../../../../src/routes/extensions/marketplace.js");

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/marketplace", marketplaceRoutes);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(() => r(null))));
beforeEach(() => {
  settings.clear();
  upstreamCalls.length = 0;
});

function send(method: string, path: string, body: unknown) {
  return realFetch(`${base}/api/marketplace${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/marketplace/update", () => {
  it("rejects a malformed request", async () => {
    const res = await send("POST", "/update", { type: "widget", id: "" });
    expect(res.status).toBe(400);
  });

  it("refuses to update a plugin that is not installed, without downloading", async () => {
    const res = await send("POST", "/update", { type: "plugin", id: "acme.missing" });
    expect(res.status).toBe(404);
    expect(upstreamCalls).toEqual([]);
  });
});

describe("PUT /api/marketplace/auto-update", () => {
  it("adds and removes an extension from the opt-in list", async () => {
    let res = await send("PUT", "/auto-update", { type: "plugin", id: "acme.forms", enabled: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ autoUpdate: { plugin: ["acme.forms"], theme: [] } });

    res = await send("PUT", "/auto-update", { type: "theme", id: "acme.dark", enabled: true });
    expect(await res.json()).toMatchObject({
      autoUpdate: { plugin: ["acme.forms"], theme: ["acme.dark"] },
    });

    res = await send("PUT", "/auto-update", { type: "plugin", id: "acme.forms", enabled: false });
    expect(await res.json()).toMatchObject({ autoUpdate: { plugin: [], theme: ["acme.dark"] } });
  });

  it("requires a boolean enabled flag", async () => {
    const res = await send("PUT", "/auto-update", { type: "plugin", id: "acme.forms", enabled: "yes" });
    expect(res.status).toBe(400);
  });
});
