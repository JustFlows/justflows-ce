// SPDX-License-Identifier: MIT

import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The server-side enrolment gate (justflows-ce#54): an account that the MFA
 * policy covers and that has no second factor is refused by every protected
 * API except the ones that let it enrol one.
 */
const state = vi.hoisted(() => ({ requirement: null as "mfa" | "passkey" | null }));

vi.mock("../../../src/lib/auth/auth-session.js", () => ({
  resolveSession: async () => ({ userId: "user-1", siteId: "site-1", role: "administrator", email: "ada@example.com" }),
}));
vi.mock("../../../src/lib/auth/session.js", () => ({ syncCsrfCookie: () => undefined }));
vi.mock("../../../src/lib/tenancy/access.js", () => ({ sessionMatchesRequestSite: () => true, isInstallationRootRequest: () => false }));
vi.mock("../../../src/lib/auth/access-policy.js", () => ({ userCan: async () => true }));
vi.mock("../../../src/lib/auth/mfa-policy.js", async (original) => ({
  ...(await original<typeof import("../../../src/lib/auth/mfa-policy.js")>()),
  enrolmentRequirement: async () => state.requirement,
}));

const { requireCapability, requireRole, requireSession } = await import("../../../src/middleware/auth.js");

const app = express();
app.get("/api/content", requireSession, (_req, res) => res.json({ ok: true }));
app.get("/api/users", requireRole("administrator"), (_req, res) => res.json({ ok: true }));
app.get("/api/settings", requireCapability("settings:manage" as never), (_req, res) => res.json({ ok: true }));
app.post("/api/auth/2fa/setup", requireSession, (_req, res) => res.json({ ok: true }));
app.get("/api/auth/me", requireSession, (_req, res) => res.json({ ok: true }));

const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
afterAll(() => new Promise((resolve) => server.close(() => resolve(null))));

async function call(method: "GET" | "POST", path: string) {
  const res = await fetch(`${base}${path}`, { method });
  return { status: res.status, body: (await res.json()) as { code?: string } };
}

beforeEach(() => {
  state.requirement = null;
});

describe("MFA enrolment gate", () => {
  it("lets accounts through when nothing is required", async () => {
    expect((await call("GET", "/api/content")).status).toBe(200);
  });

  it("refuses protected APIs with a code the admin can act on", async () => {
    state.requirement = "mfa";
    for (const path of ["/api/content", "/api/users", "/api/settings"]) {
      const res = await call("GET", path);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("mfa_enrollment_required");
    }
    state.requirement = "passkey";
    expect((await call("GET", "/api/content")).body.code).toBe("passkey_enrollment_required");
  });

  it("still allows enrolling a factor and reading the session", async () => {
    state.requirement = "mfa";
    expect((await call("POST", "/api/auth/2fa/setup")).status).toBe(200);
    expect((await call("GET", "/api/auth/me")).status).toBe(200);
  });
});
