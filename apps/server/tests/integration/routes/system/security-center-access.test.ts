// SPDX-License-Identifier: MIT

import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let role = "administrator";
let installationRoot = true;
const loadSecurityCenter = vi.fn(async () => ({ checks: [] }));
const loadIntegrityOverview = vi.fn(async () => ({
  checkedAt: "2026-11-05T00:00:00.000Z",
  core: "verified",
  verified: 1,
  unverifiable: 0,
  failed: 0,
  packages: [],
}));
const auditFromRequest = vi.fn();

vi.mock("../../../../src/middleware/auth.js", () => ({
  requireRole:
    (...roles: string[]) =>
    (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!roles.includes(role)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      next();
    },
}));
vi.mock("../../../../src/lib/tenancy/access.js", () => ({
  isInstallationRootRequest: () => installationRoot,
}));
vi.mock("../../../../src/lib/security/security-center-load.js", () => ({ loadSecurityCenter }));
vi.mock("../../../../src/lib/security/extension-integrity.js", () => ({ loadIntegrityOverview }));
vi.mock("../../../../src/lib/security/audit-log.js", () => ({ auditFromRequest }));

const { default: securityRoutes } = await import("../../../../src/routes/system/security.js");

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/security", securityRoutes);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(() => r(null))));
beforeEach(() => {
  role = "administrator";
  installationRoot = true;
  vi.clearAllMocks();
});

describe("Security Center access", () => {
  it.each(["editor", "author", "subscriber"])("refuses the report to %s", async (name) => {
    role = name;
    const res = await fetch(`${base}/api/security/center`);
    expect(res.status).toBe(403);
    expect(loadSecurityCenter).not.toHaveBeenCalled();
  });

  it.each(["editor", "author", "subscriber"])("refuses integrity results to %s", async (name) => {
    role = name;
    expect((await fetch(`${base}/api/security/integrity`)).status).toBe(403);
    expect(loadIntegrityOverview).not.toHaveBeenCalled();
  });

  it("does not let a non-administrator start a scan", async () => {
    role = "editor";
    const res = await fetch(`${base}/api/security/integrity/scan`, { method: "POST" });
    expect(res.status).toBe(403);
    expect(loadIntegrityOverview).not.toHaveBeenCalled();
    expect(auditFromRequest).not.toHaveBeenCalled();
  });

  it("gives a subsite administrator no installation integrity data", async () => {
    installationRoot = false;
    const res = await fetch(`${base}/api/security/integrity`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ installationRoot: false, packages: [], verified: 0 });
    expect(loadIntegrityOverview).not.toHaveBeenCalled();
  });

  it("does not let a subsite administrator start a scan", async () => {
    installationRoot = false;
    const res = await fetch(`${base}/api/security/integrity/scan`, { method: "POST" });
    expect(res.status).toBe(403);
    expect(loadIntegrityOverview).not.toHaveBeenCalled();
  });

  it("lets an installation administrator scan and records it", async () => {
    const res = await fetch(`${base}/api/security/integrity/scan`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(loadIntegrityOverview).toHaveBeenCalledWith(true);
    expect(auditFromRequest).toHaveBeenCalledWith(expect.anything(), "integrity.scanned", expect.anything());
  });
});
