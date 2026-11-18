// SPDX-License-Identifier: MIT

import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPortableBackup } from "../../../../src/lib/backup/portable-archive.js";
import { createBackupContainer } from "../../../../src/lib/backup/backup-container.js";
import { sealBackup } from "../../../../src/lib/backup/archive-crypto.js";

/**
 * Who may back up and restore what, through the real backup router: roles,
 * the installation root, platform operators, the workspace boundary, the
 * confirmation phrase, and the passphrase. Every refusal happens before a
 * job starts or any restore code runs.
 */
const session = vi.hoisted(() => ({ role: "administrator", siteId: "root-site", userId: "user-1", root: true, operator: true }));
const startBackupJob = vi.hoisted(() => vi.fn(async () => "job-1"));
const restoreSingleSite = vi.hoisted(() => vi.fn());
const restoreNetwork = vi.hoisted(() => vi.fn());
const getBackupJob = vi.hoisted(() =>
  vi.fn(async (id: string, siteId: string) =>
    id === "job-1" && siteId === "root-site"
      ? { id, siteId, kind: "backup", status: "ready", progress: 100, message: "", error: null, result: null, files: [], createdSites: [], updatedAt: 0, heartbeatAt: 0 }
      : null,
  ),
);

/** The 3-per-minute create limit runs first in production; here it would hide the checks under test. */
vi.mock("express-rate-limit", () => ({
  rateLimit: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock("../../../../src/middleware/auth.js", () => ({
  requireRole:
    (...roles: string[]) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!roles.includes(session.role)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      (req as unknown as { session: unknown }).session = { siteId: session.siteId, userId: session.userId, role: session.role };
      next();
    },
}));
vi.mock("../../../../src/lib/tenancy/access.js", () => ({
  isInstallationRootRequest: () => session.root,
  isPlatformOperator: async () => session.operator,
}));
vi.mock("../../../../src/lib/security/audit-log.js", () => ({ auditFromRequest: vi.fn() }));
vi.mock("../../../../src/lib/backup/backup-jobs.js", () => ({
  startBackupJob,
  getBackupJob,
  runningBackupJob: async () => null,
  discardBackupJob: vi.fn(),
  readBackupJobFile: vi.fn(async () => null),
  saveRollbackSnapshot: vi.fn(),
}));
vi.mock("../../../../src/lib/backup/restore-backup.js", () => ({
  restoreSingleSite,
  restoreNetwork,
  restoreTargetState: async () => ({ clean: true, existingSubsites: 0, multisite: true }),
  summarizeBackup: () => ({ kind: "site", createdAt: "", source: { siteId: "s" }, sites: [], packages: [], extensions: { plugins: [], themes: [] } }),
  unavailableExtensions: async () => ({}),
}));
vi.mock("../../../../src/lib/backup/workspace-backup.js", () => ({
  buildNetworkBackup: vi.fn(),
  buildSiteBackup: vi.fn(),
  buildSubsiteBackups: vi.fn(),
  workspaceRestoreTargets: async () => [
    { id: "root-site", name: "Root", root: true },
    { id: "child-site", name: "Child", root: false },
  ],
}));

const { default: backupRoutes } = await import("../../../../src/routes/system/backups.js");

const passphrase = "route test passphrase";

function site(siteId: string): Buffer {
  return createPortableBackup({
    createdAt: "2026-11-18T10:00:00.000Z",
    source: { siteId, siteName: siteId, databaseDriver: "postgres" },
    data: { site: { id: siteId }, tables: {}, quotaLimits: [], pluginTables: [], packages: [], files: [], privateFiles: [], themeFiles: [], database: null, undecryptableSecrets: 0, extensions: { plugins: [], themes: [] } },
  });
}

function file(kind: "site" | "network"): Buffer {
  const sites =
    kind === "site"
      ? [{ siteId: "src", siteName: "Source", root: false, hostnames: [], archive: site("src") }]
      : [
          { siteId: "src-root", siteName: "Root", root: true, hostnames: [], archive: site("src-root") },
          { siteId: "src-child", siteName: "Child", root: false, hostnames: [], archive: site("src-child") },
        ];
  const container = createBackupContainer({ kind, createdAt: "2026-11-18T10:00:00.000Z", databaseDriver: "postgres", installation: null, sites, packages: [] });
  return sealBackup(container, passphrase, { kind, createdAt: "2026-11-18T10:00:00.000Z", siteName: "Source" });
}

function form(kind: "site" | "network", fields: Record<string, string>): FormData {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  body.append("file", new Blob([new Uint8Array(file(kind))]), "backup.jfbackup");
  return body;
}

let server: Server;
let base = "";

beforeAll(async () => {
  process.env.APP_SECRET ||= "route-test-secret-of-at-least-32-characters";
  const app = express();
  app.use(express.json());
  app.use("/api/backups", backupRoutes);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/backups`;
});
afterAll(() => new Promise((resolve) => server.close(() => resolve(null))));
beforeEach(() => {
  Object.assign(session, { role: "administrator", siteId: "root-site", userId: "user-1", root: true, operator: true });
  vi.clearAllMocks();
});

const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("backup and restore access", () => {
  it.each(["editor", "author", "subscriber"])("refuses every backup action to %s", async (role) => {
    session.role = role;
    expect((await fetch(`${base}/jobs`, json({ passphrase }))).status).toBe(403);
    expect((await fetch(`${base}/jobs/job-1`)).status).toBe(403);
    expect((await fetch(`${base}/restore`, { method: "POST", body: form("site", { passphrase, confirmation: "RESTORE SITE" }) })).status).toBe(403);
    expect((await fetch(`${base}/network/restore`, { method: "POST", body: form("network", { passphrase, confirmation: "RESTORE NETWORK" }) })).status).toBe(403);
    expect(startBackupJob).not.toHaveBeenCalled();
  });

  it("refuses network and subsite backups, schedules, and network restores outside the installation root", async () => {
    session.root = false;
    session.siteId = "child-site";
    expect((await fetch(`${base}/jobs`, json({ scope: "network", passphrase }))).status).toBe(403);
    expect((await fetch(`${base}/jobs`, json({ scope: "subsites", passphrase }))).status).toBe(403);
    expect((await fetch(`${base}/schedule`)).status).toBe(403);
    expect((await fetch(`${base}/network/restore`, { method: "POST", body: form("network", { passphrase, confirmation: "RESTORE NETWORK" }) })).status).toBe(403);
    expect(startBackupJob).not.toHaveBeenCalled();
  });

  it("refuses a backup without a strong enough passphrase", async () => {
    const res = await fetch(`${base}/jobs`, json({ passphrase: "short" }));
    expect(res.status).toBe(400);
    expect(startBackupJob).not.toHaveBeenCalled();
  });

  it("refuses a restore into a site outside the workspace", async () => {
    const res = await fetch(`${base}/restore`, { method: "POST", body: form("site", { passphrase, confirmation: "RESTORE SITE", targetSiteId: "other-workspace-site" }) });
    expect(res.status).toBe(403);
    expect(startBackupJob).not.toHaveBeenCalled();
  });

  it("lets a subsite administrator restore only into their own site", async () => {
    session.root = false;
    session.siteId = "child-site";
    const res = await fetch(`${base}/restore`, { method: "POST", body: form("site", { passphrase, confirmation: "RESTORE SITE", targetSiteId: "root-site" }) });
    expect(res.status).toBe(403);
    expect(startBackupJob).not.toHaveBeenCalled();
  });

  it("refuses a network restore that creates subsites to a root administrator who is not a platform operator", async () => {
    session.operator = false;
    const res = await fetch(`${base}/network/restore`, { method: "POST", body: form("network", { passphrase, confirmation: "RESTORE NETWORK" }) });
    expect(res.status).toBe(403);
    expect(startBackupJob).not.toHaveBeenCalled();
  });

  it("needs the exact confirmation phrase and the right passphrase", async () => {
    expect((await fetch(`${base}/restore`, { method: "POST", body: form("site", { passphrase, confirmation: "restore site" }) })).status).toBe(400);
    expect((await fetch(`${base}/restore`, { method: "POST", body: form("site", { passphrase: "a wrong passphrase", confirmation: "RESTORE SITE" }) })).status).toBe(422);
    expect((await fetch(`${base}/network/restore`, { method: "POST", body: form("network", { passphrase, confirmation: "RESTORE SITE" }) })).status).toBe(400);
    expect(startBackupJob).not.toHaveBeenCalled();
  });

  it("does not restore a network file into one site or a site file as a network", async () => {
    expect((await fetch(`${base}/restore`, { method: "POST", body: form("network", { passphrase, confirmation: "RESTORE SITE" }) })).status).toBe(400);
    expect((await fetch(`${base}/network/restore`, { method: "POST", body: form("site", { passphrase, confirmation: "RESTORE NETWORK" }) })).status).toBe(400);
    expect(startBackupJob).not.toHaveBeenCalled();
  });

  it("shows a job only to the site that started it", async () => {
    expect((await fetch(`${base}/jobs/job-1`)).status).toBe(200);
    session.root = false;
    session.siteId = "child-site";
    expect((await fetch(`${base}/jobs/job-1`)).status).toBe(404);
    expect((await fetch(`${base}/jobs/job-1`, { method: "DELETE" })).status).toBe(404);
    expect((await fetch(`${base}/jobs/job-1/download/0`)).status).toBe(404);
  });

  it("starts a restore for an allowed target", async () => {
    const res = await fetch(`${base}/restore`, { method: "POST", body: form("site", { passphrase, confirmation: "RESTORE SITE", targetSiteId: "child-site" }) });
    expect(res.status).toBe(202);
    expect(startBackupJob).toHaveBeenCalledTimes(1);
  });
});
