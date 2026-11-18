// SPDX-License-Identifier: MIT

import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Plugin trust routes (justflows-ce#270): administrators only, operator trust
 * only from the main site of a single-site installation, with the current
 * password, bound to the digest the administrator saw, and audited.
 */
const state = vi.hoisted(() => ({
  root: true,
  allowed: true,
  digest: "a".repeat(64) as string | null,
  trustCalls: [] as Array<{ pluginId: string; archiveDigest: string; trusted: boolean }>,
  audits: [] as string[],
}));

vi.mock("../../../../src/middleware/auth.js", () => ({
  requireRole: (...roles: string[]) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const role = req.header("x-test-role");
    if (!role) return void res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(role)) return void res.status(403).json({ error: "Forbidden" });
    (req as unknown as { session: unknown }).session = { userId: "user-1", siteId: "site-1", role, email: "admin@example.com" };
    next();
  },
  requireSession: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../../../src/lib/tenancy/access.js", () => ({ isInstallationRootRequest: () => state.root }));
vi.mock("../../../../src/lib/security/audit-log.js", () => ({
  auditFromRequest: (_req: unknown, action: string, entry: { detail?: string }) => state.audits.push(`${action}:${entry.detail ?? ""}`),
}));
vi.mock("../../../../src/lib/security/rate-limit.js", () => ({ consumeRateLimit: () => true }));
vi.mock("../../../../src/lib/database/db.js", () => ({
  getDb: async () => ({ query: async () => [{ password_hash: "hash" }] }),
}));
vi.mock("../../../../src/lib/auth/password.js", () => ({ verifyPassword: async (password: string) => password === "correct horse" }));
vi.mock("../../../../src/lib/extensions/plugin-trust.js", () => {
  class OperatorTrustRefusedError extends Error {}
  const row = () => ({ pluginId: "own.plugin", version: "1.0.0", state: "unverified", reason: "noAttestation", archiveDigest: state.digest });
  return {
    OperatorTrustRefusedError,
    listPluginTrust: async () => [row()],
    getPluginTrustPolicy: async () => ({ legacySince: "2026-11-18T00:00:00.000Z", operatorTrusted: [] }),
    loadAttestationFeed: async () => ({ state: "unavailable" }),
    operatorTrustAllowed: async () => state.allowed,
    legacyDeadline: () => "2027-02-16T00:00:00.000Z",
    recordTrustTransitions: async () => [],
    pluginSandboxMode: () => "off",
    setOperatorTrust: async (input: { pluginId: string; archiveDigest: string; trusted: boolean }) => void state.trustCalls.push(input),
  };
});

const { default: pluginRoutes } = await import("../../../../src/routes/extensions/plugins.js");

const app = express();
app.use(express.json());
app.use("/api/plugins", pluginRoutes);
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/plugins`;
afterAll(() => new Promise((resolve) => server.close(() => resolve(null))));

async function call(path: string, role: string | null, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(role ? { "x-test-role": role } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const trustBody = { trusted: true, password: "correct horse", archiveDigest: "a".repeat(64) };

beforeEach(() => {
  state.root = true;
  state.allowed = true;
  state.digest = "a".repeat(64);
  state.trustCalls = [];
  state.audits = [];
});

describe("plugin trust routes", () => {
  it("lists trust states for administrators only", async () => {
    expect((await call("/trust", null)).status).toBe(401);
    expect((await call("/trust", "editor")).status).toBe(403);
    const ok = await call("/trust", "administrator");
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ legacyUntil: "2027-02-16T00:00:00.000Z", attestations: { state: "unavailable" }, operatorTrustAllowed: true });
    expect(ok.body.plugins[0]).toMatchObject({ pluginId: "own.plugin", state: "unverified" });
  });

  it("trusts the exact digest with the password, and audits it", async () => {
    const res = await call("/own.plugin/trust", "administrator", trustBody);
    expect(res.status).toBe(200);
    expect(state.trustCalls).toEqual([expect.objectContaining({ pluginId: "own.plugin", archiveDigest: "a".repeat(64), trusted: true })]);
    expect(state.audits).toEqual([`extension.operator_trusted:1.0.0 sha256:${"a".repeat(64)}`]);
  });

  it("refuses editors, subsites, multisite networks, a wrong password, and a changed or missing package", async () => {
    expect((await call("/own.plugin/trust", "editor", trustBody)).status).toBe(403);
    state.root = false;
    expect((await call("/own.plugin/trust", "administrator", trustBody)).status).toBe(403);
    state.root = true;
    state.allowed = false;
    expect((await call("/own.plugin/trust", "administrator", trustBody)).status).toBe(403);
    expect((await call("/trust", "administrator")).body.operatorTrustAllowed).toBe(false);
    state.allowed = true;
    expect((await call("/own.plugin/trust", "administrator", { ...trustBody, password: "wrong" })).status).toBe(403);
    expect((await call("/own.plugin/trust", "administrator", { ...trustBody, archiveDigest: "b".repeat(64) })).status).toBe(409);
    state.digest = null;
    expect((await call("/own.plugin/trust", "administrator", { ...trustBody, archiveDigest: null })).status).toBe(409);
    expect((await call("/missing.plugin/trust", "administrator", trustBody)).status).toBe(404);
    expect(state.trustCalls).toEqual([]);
    expect(state.audits).toEqual([]);
  });
});
