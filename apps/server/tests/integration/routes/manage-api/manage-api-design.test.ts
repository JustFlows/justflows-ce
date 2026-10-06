// SPDX-License-Identifier: MIT
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let allow = true;

vi.mock("../../../../src/lib/auth/api-keys.js", () => ({
  keyCan: async () => allow,
}));

const { default: router } = await import("../../../../src/routes/manage-api/design.js");

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.apiKey = { id: "key-1", scope: {}, capabilities: [] } as never;
    req.apiKeyOwner = { userId: "u1", siteId: "s1", role: "administrator" };
    req.session = { userId: "u1", siteId: "s1", role: "api-key", email: "", iat: 0 };
    next();
  });
  app.use("/api/manage/v1", router);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/manage/v1`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  allow = true;
});

describe("management API design routes", () => {
  it("refuses the header library without content:read", async () => {
    allow = false;
    const res = await fetch(`${base}/headers`);
    expect(res.status).toBe(403);
  });

  it("rejects a header library that is not an object", async () => {
    const res = await fetch(`${base}/headers`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ library: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown template part", async () => {
    const res = await fetch(`${base}/template-parts/sidebar`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "Unknown template part" });
  });
});
