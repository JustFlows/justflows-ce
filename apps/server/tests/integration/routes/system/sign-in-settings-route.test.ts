// SPDX-License-Identifier: MIT

import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sign-in settings (justflows-ce#54): administrators only, the client secret
 * is write-only and kept when left blank, issuers must use https, and every
 * change is audited.
 */
process.env.APP_SECRET ||= "sign-in-settings-test-secret-32-characters";
delete process.env.JF_OIDC_ALLOW_HTTP;

const state = vi.hoisted(() => ({ settings: new Map<string, unknown>(), audits: [] as string[] }));

vi.mock("../../../../src/middleware/auth.js", () => ({
  requireRole: (...roles: string[]) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const role = req.header("x-test-role");
    if (!role) return void res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(role)) return void res.status(403).json({ error: "Forbidden" });
    next();
  },
}));
vi.mock("../../../../src/lib/settings/site-settings.js", () => ({
  getSiteId: async () => "site-1",
  getSiteSetting: async (_siteId: string, key: string) => state.settings.get(key) ?? null,
  setSiteSetting: async (_siteId: string, key: string, value: unknown) => void state.settings.set(key, value),
}));
vi.mock("../../../../src/lib/security/audit-log.js", () => ({
  auditFromRequest: (_req: unknown, action: string) => state.audits.push(action),
  auditLog: () => undefined,
  auditContext: () => ({}),
}));
vi.mock("../../../../src/lib/auth/assignable-roles.js", () => ({
  listAssignableRoles: async () => [{ id: "administrator", label: "Administrator" }, { id: "editor", label: "Editor" }],
}));
vi.mock("../../../../src/lib/ai/ai-settings.js", () => ({ publicOrigin: () => "https://site.example" }));

const { default: securityRoutes } = await import("../../../../src/routes/system/security.js");

const app = express();
app.use(express.json());
app.use("/api/security", securityRoutes);
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/security/sign-in`;
afterAll(() => new Promise((resolve) => server.close(() => resolve(null))));

async function call(method: "GET" | "PUT", role: string | null, body?: unknown) {
  const res = await fetch(base, {
    method,
    headers: { "content-type": "application/json", ...(role ? { "x-test-role": role } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const provider = { id: "corp", name: "Corp SSO", issuer: "https://login.corp.example", clientId: "justflows", clientSecret: "shh", allowedDomains: ["Corp.Example"] };

beforeEach(() => {
  state.settings.clear();
  state.audits = [];
});

describe("sign-in settings route", () => {
  it("is for administrators only", async () => {
    expect((await call("GET", null)).status).toBe(401);
    expect((await call("GET", "editor")).status).toBe(403);
    expect((await call("PUT", "editor", { mfa: { requiredRoles: [] } })).status).toBe(403);
    const ok = await call("GET", "administrator");
    expect(ok.status).toBe(200);
    expect(ok.body.roles).toEqual([{ id: "administrator", name: "Administrator" }, { id: "editor", name: "Editor" }]);
    expect(ok.body.callbackBase).toBe("https://site.example/api/auth/oidc/");
  });

  it("saves the MFA policy and providers, never returns the secret, and keeps it when left blank", async () => {
    const saved = await call("PUT", "administrator", { mfa: { requiredRoles: ["administrator"] }, providers: [provider] });
    expect(saved.status).toBe(200);
    expect(saved.body.mfa).toEqual({ requiredRoles: ["administrator"] });
    expect(saved.body.providers[0]).toMatchObject({ id: "corp", clientSecretSet: true, allowedDomains: ["corp.example"], scopes: ["openid", "email", "profile"] });
    expect(JSON.stringify(saved.body)).not.toContain("shh");
    const stored = state.settings.get("security.oidc") as { providers: Array<{ clientSecretCipher: string }> };
    expect(stored.providers[0]!.clientSecretCipher).not.toContain("shh");
    expect(state.audits).toEqual(["security.mfa_policy_changed", "security.oidc_providers_changed"]);

    const { clientSecret: _omit, ...withoutSecret } = provider;
    const kept = await call("PUT", "administrator", { providers: [{ ...withoutSecret, name: "Corp" }] });
    expect(kept.body.providers[0]).toMatchObject({ name: "Corp", clientSecretSet: true });
    expect((state.settings.get("security.oidc") as { providers: Array<{ clientSecretCipher: string }> }).providers[0]!.clientSecretCipher).toBe(stored.providers[0]!.clientSecretCipher);
  });

  it("refuses plain-http issuers, duplicate ids, and unknown role formats", async () => {
    expect((await call("PUT", "administrator", { providers: [{ ...provider, issuer: "http://login.corp.example" }] })).status).toBe(400);
    expect((await call("PUT", "administrator", { providers: [provider, provider] })).status).toBe(400);
    expect((await call("PUT", "administrator", { mfa: { requiredRoles: ["Bad Role"] } })).status).toBe(400);
    expect(state.settings.size).toBe(0);
  });
});
