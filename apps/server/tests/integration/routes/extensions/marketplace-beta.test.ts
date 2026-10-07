// SPDX-License-Identifier: MIT

import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let allowBeta: boolean | null = null;
let listingRegistry: Record<string, unknown> = {};
const upstreamCalls: string[] = [];

// Site feature switches live in the control database; keep the feature on here.
vi.mock("../../../../src/lib/tenancy/site-features.js", () => ({ siteFeatureEnabled: async () => true }));
vi.mock("../../../../src/middleware/auth.js", () => ({
  requireRole: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { session: { siteId: string } }).session = { siteId: "site-1" };
    next();
  },
}));
vi.mock("../../../../src/lib/settings/site-settings.js", () => ({
  getSiteSetting: async (_siteId: string, key: string) =>
    key === "marketplace_allow_beta" ? allowBeta : null,
}));

const realFetch = globalThis.fetch;
vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith("https://api.justflows.com/")) return realFetch(input, init);
  upstreamCalls.push(url);
  if (url.endsWith("/download")) return new Response("unavailable", { status: 502 });
  return Response.json({ id: "acme.beta", version: "0.1.0", registry: listingRegistry });
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
  allowBeta = null;
  listingRegistry = { listed: true, free: true, beta: true };
  upstreamCalls.length = 0;
});

function install() {
  return realFetch(`${base}/api/marketplace/install`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "plugin", id: "acme.beta", version: "0.1.0" }),
  });
}

const downloaded = () => upstreamCalls.some((url) => url.endsWith("/download"));

describe("POST /api/marketplace/install beta gate", () => {
  it("refuses a beta listing when the site has not opted in", async () => {
    const res = await install();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "beta_disabled" });
    expect(downloaded()).toBe(false);
  });

  it("refuses a beta listing when the setting is explicitly off", async () => {
    allowBeta = false;
    expect((await install()).status).toBe(403);
    expect(downloaded()).toBe(false);
  });

  it("proceeds to download a beta listing once beta installs are allowed", async () => {
    allowBeta = true;
    const res = await install();
    expect(res.status).not.toBe(403);
    expect(downloaded()).toBe(true);
  });

  it("does not gate stable listings", async () => {
    listingRegistry = { listed: true, free: true };
    await install();
    expect(downloaded()).toBe(true);
  });
});
