// SPDX-License-Identifier: MIT

import express from "express";
import fs from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The admin "Check" action runs the extension checker on an installed
 * plugin's files (justflows-ce#97): administrators on the main site only, and
 * only folders inside the installation's package directories.
 */
const state = vi.hoisted(() => ({ role: "administrator", root: true, plugin: null as null | Record<string, unknown> }));
const scratch = vi.hoisted(() => ({ dir: "" }));

vi.mock("../../../../src/middleware/auth.js", () => ({
  requireRole:
    (...roles: string[]) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!roles.includes(state.role)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      (req as unknown as { session: unknown }).session = { siteId: "site-1", userId: "user-1", role: state.role };
      next();
    },
  requireSession: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock("../../../../src/lib/tenancy/access.js", () => ({ isInstallationRootRequest: () => state.root }));
vi.mock("express-rate-limit", () => ({
  default: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  rateLimit: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock("../../../../src/lib/extensions/packages-dir.js", () => ({
  packagesInstalledDir: () => path.join(scratch.dir, "packages-installed"),
  siteThemesDir: () => null,
}));
vi.mock("../../../../src/lib/plugins/plugins-db.js", () => ({
  getPlugin: async () => state.plugin,
  pluginsDir: () => path.join(scratch.dir, "plugins"),
  pluginToDto: (row: unknown) => row,
}));

let server: Server;
let base = "";
let installed = "";

beforeAll(async () => {
  scratch.dir = fs.mkdtempSync(path.join(os.tmpdir(), "jf-plugin-check-"));
  installed = path.join(scratch.dir, "packages-installed", "plugins", "justflows.acme", "1.0.0", "abc");
  fs.mkdirSync(path.join(installed, "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(installed, "justflows.json"),
    JSON.stringify({ schemaVersion: 1, type: "plugin", id: "justflows.acme", name: "Acme", version: "1.0.0", publisher: "Acme", license: "MIT", engines: { justflows: ">=0.1.0" }, permissions: [] }),
  );
  fs.writeFileSync(path.join(installed, "dist", "index.js"), "export default { activate(ctx) { return ctx.mail.send({}); } };");
  fs.writeFileSync(path.join(installed, "LICENSE"), "MIT");
  const { default: pluginRoutes } = await import("../../../../src/routes/extensions/plugins.js");
  const app = express();
  app.use(express.json());
  app.use("/api/plugins", pluginRoutes);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/plugins`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve(null)));
  fs.rmSync(scratch.dir, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.JF_EXTENSION_CHECKER = "on";
  Object.assign(state, { role: "administrator", root: true, plugin: { plugin_id: "justflows.acme", manifest: { installedPath: installed } } });
});

describe("checking an installed plugin", () => {
  it("reports findings for the installed files without exposing the server path", async () => {
    const res = await fetch(`${base}/justflows.acme/check`);
    expect(res.status).toBe(200);
    const { report } = (await res.json()) as { report: { target: { path: string; mode: string }; findings: Array<{ rule: string }> } };
    expect(report.target).toMatchObject({ path: "justflows.acme", mode: "package" });
    expect(report.findings.map((item) => item.rule)).toContain("JF-P001");
    expect(JSON.stringify(report)).not.toContain(scratch.dir);
  });

  it("is off unless JF_EXTENSION_CHECKER=on, and says how to turn it on", async () => {
    delete process.env.JF_EXTENSION_CHECKER;
    const res = await fetch(`${base}/justflows.acme/check`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain("JF_EXTENSION_CHECKER=on");
    process.env.JF_EXTENSION_CHECKER = "off";
    expect((await fetch(`${base}/justflows.acme/check`)).status).toBe(404);
  });

  it("is only for administrators on the main site", async () => {
    state.role = "editor";
    expect((await fetch(`${base}/justflows.acme/check`)).status).toBe(403);
    state.role = "administrator";
    state.root = false;
    expect((await fetch(`${base}/justflows.acme/check`)).status).toBe(403);
  });

  it("refuses a recorded path outside the package directories", async () => {
    state.plugin = { plugin_id: "justflows.acme", manifest: { installedPath: os.homedir() } };
    expect((await fetch(`${base}/justflows.acme/check`)).status).toBe(404);
    state.plugin = { plugin_id: "justflows.acme", manifest: { installedPath: path.join(scratch.dir, "packages-installed", "..", "..") } };
    expect((await fetch(`${base}/justflows.acme/check`)).status).toBe(404);
  });
});
