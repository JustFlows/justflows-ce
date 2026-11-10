// SPDX-License-Identifier: MIT
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  root: true,
  find: vi.fn(async () => undefined),
  allow: vi.fn((_key: string) => true),
}));
vi.mock("../../../../src/lib/database/db.js", () => ({ getControlDb: async () => ({ query: vi.fn() }) }));
vi.mock("../../../../src/lib/tenancy/provision.js", () => ({ createWorkspace: vi.fn() }));
vi.mock("../../../../src/lib/tenancy/access.js", () => ({ isInstallationRootRequest: () => mocks.root }));
vi.mock("../../../../src/lib/tenancy/find-sites.js", () => ({ processFindSites: mocks.find }));
vi.mock("../../../../src/lib/security/rate-limit.js", () => ({ clientIp: () => "test", consumeRateLimit: mocks.allow, rateLimitRetryAfter: () => 60 }));
const { default: router } = await import("../../../../src/routes/public/signup.js");
let server: Server;
let endpoint: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/signup", router);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/signup/find-sites`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  mocks.root = true;
  mocks.find.mockClear();
  mocks.allow.mockReset();
  mocks.allow.mockReturnValue(true);
});
const find = (email: unknown) => fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
it("answers 202 without any site data and hands a normalized address to the mailer", async () => {
  const response = await find(" Owner@Example.COM ");
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ ok: true });
  expect(mocks.find).toHaveBeenCalledWith("owner@example.com", expect.objectContaining({ ip: "test" }));
});
it("rejects malformed addresses without looking anything up", async () => {
  expect((await find("not-an-email")).status).toBe(400);
  expect(mocks.find).not.toHaveBeenCalled();
});
it.each(["findsites:email:", "findsites:email-day:"])("limits requests per address (%s)", async (prefix) => {
  mocks.allow.mockImplementation((key: string) => !key.startsWith(prefix));
  const response = await find("owner@example.com");
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("60");
  expect(mocks.find).not.toHaveBeenCalled();
});
it("ignores the Host header when building the mailed link", async () => {
  await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", host: "evil.example" }, body: JSON.stringify({ email: "owner@example.com" }) });
  expect(JSON.stringify(mocks.find.mock.calls)).not.toContain("evil.example");
});
it("only answers on the installation root site", async () => {
  mocks.root = false;
  expect((await find("owner@example.com")).status).toBe(404);
  expect(mocks.find).not.toHaveBeenCalled();
});
