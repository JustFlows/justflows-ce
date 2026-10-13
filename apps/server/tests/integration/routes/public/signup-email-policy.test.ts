// SPDX-License-Identifier: MIT
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { defaultSignupEmailPolicy } from "../../../../src/lib/security/signup-email-policy.js";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  create: vi.fn(async () => ({ ok: true, hostname: "demo.example.com" })),
}));
vi.mock("../../../../src/lib/database/db.js", () => ({ getControlDb: async () => ({ query: mocks.query }) }));
vi.mock("../../../../src/lib/tenancy/provision.js", () => ({ createWorkspace: mocks.create }));
vi.mock("../../../../src/lib/security/rate-limit.js", () => ({ clientIp: () => "test", consumeRateLimit: () => true, rateLimitRetryAfter: () => 0 }));
const { default: router } = await import("../../../../src/routes/public/signup.js");
let server: Server;
let endpoint: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/signup", router);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/signup`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => mocks.create.mockClear());
const signup = (email: string) => fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "long-test-password", displayName: "Test", siteName: "Demo", slug: "demo" }) });
it("rejects disposable, blocked and unlisted addresses before provisioning", async () => {
  mocks.query.mockResolvedValue([{ value: { signupEnabled: true, baseDomain: "example.com", signupEmailPolicy: { ...defaultSignupEmailPolicy(), blockDisposable: true, block: ["blocked.example"] } } }]);
  expect((await signup("test@mailinator.com")).status).toBe(403);
  expect((await signup("test@blocked.example")).status).toBe(403);
  mocks.query.mockResolvedValue([{ value: { signupEnabled: true, baseDomain: "example.com", signupEmailPolicy: { ...defaultSignupEmailPolicy(), allowListedOnly: true, allow: ["trusted.example"] } } }]);
  expect((await signup("test@other.example")).status).toBe(403);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("allows a trusted disposable exception and passes a normalized email", async () => {
  mocks.query.mockResolvedValue([{ value: { signupEnabled: true, baseDomain: "example.com", signupEmailPolicy: { ...defaultSignupEmailPolicy(), blockDisposable: true, allow: ["trusted@mailinator.com"] } } }]);
  expect((await signup(" TRUSTED@MAILINATOR.COM ")).status).toBe(201);
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ admin: expect.objectContaining({ email: "trusted@mailinator.com" }), requireNewOwner: true }));
});
