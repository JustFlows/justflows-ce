// SPDX-License-Identifier: MIT

import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PackageRejectedError } from "@justflows/installer";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const audited: Array<{ action: string; detail?: string }> = [];
const insertPlugin = vi.fn(async () => undefined);
const runtimeDeactivatePlugin = vi.fn(async () => undefined);
const installMarketplacePackage = vi.fn();

vi.mock("../../../../src/middleware/auth.js", () => ({
  requireRole: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { session: { siteId: string; userId: string; role: string } }).session = {
      siteId: "site-1",
      userId: "user-1",
      role: "administrator",
    };
    next();
  },
}));
vi.mock("../../../../src/lib/settings/site-settings.js", () => ({
  getSiteId: async () => "site-1",
  getSiteSetting: async (_siteId: string, key: string) =>
    key === "extensions.auto_update" ? { plugin: ["acme.forms"], theme: [] } : null,
  setSiteSetting: async () => undefined,
}));
vi.mock("../../../../src/lib/security/audit-log.js", () => ({
  auditFromRequest: () => undefined,
  auditLog: async (entry: { action: string; detail?: string }) => {
    audited.push(entry);
  },
}));
vi.mock("../../../../src/lib/tenancy/registry.js", () => ({
  isInstallationRootSite: async () => true,
}));
vi.mock("../../../../src/lib/plugins/plugins-db.js", () => ({
  getPlugin: async () => ({ status: "active", version: "1.0.0", manifest: { permissions: [] } }),
  insertPlugin,
  markPluginError: async () => undefined,
}));
vi.mock("../../../../src/lib/plugins/plugin-runtime.js", () => ({
  runtimeActivatePlugin: async () => undefined,
  runtimeDeactivatePlugin,
  runtimeUnloadPlugin: async () => undefined,
}));
vi.mock("../../../../src/lib/cache/cache-revalidate.js", () => ({
  revalidateOnUpdate: async () => undefined,
}));
vi.mock("../../../../src/lib/extensions/marketplace-package.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  installMarketplacePackage,
}));

const { PluginPermissionApprovalError } = await import(
  "../../../../src/lib/plugins/plugin-permission-approval.js"
);
const { updateExtension } = await import("../../../../src/lib/extensions/extension-updates.js");
const { default: marketplaceRoutes } = await import("../../../../src/routes/extensions/marketplace.js");

function refusal() {
  const cause = new PluginPermissionApprovalError("acme.forms", "Forms", ["files:private"]);
  return new PackageRejectedError(cause.message, cause);
}

function installed(approvedPermissions: string[]) {
  return {
    manifest: { id: "acme.forms", version: "1.1.0" },
    installedPath: "/packages/acme.forms/1.1.0",
    digest: "a".repeat(64),
    approvedPermissions,
  };
}

let server: Server;
let base = "";

async function update(approvedPermissions?: string[]) {
  return fetch(`${base}/api/marketplace/update`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "plugin", id: "acme.forms", version: "1.1.0", approvedPermissions }),
  });
}

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
  audited.length = 0;
  vi.clearAllMocks();
});

describe("plugin update permission approval", () => {
  it("leaves the running plugin alone when the update is refused", async () => {
    installMarketplacePackage.mockRejectedValueOnce(refusal());
    const res = await update();
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      code: "permission_approval_required",
      permissions: ["files:private"],
    });
    expect(runtimeDeactivatePlugin).not.toHaveBeenCalled();
    expect(insertPlugin).not.toHaveBeenCalled();
    expect(audited).toEqual([]);
  });

  it("passes the approval to the installer and records it", async () => {
    installMarketplacePackage.mockResolvedValueOnce(installed(["files:private"]));
    const res = await update(["files:private"]);
    expect(res.status).toBe(200);
    expect(installMarketplacePackage).toHaveBeenCalledWith(
      expect.objectContaining({ approvedPermissions: ["files:private"] }),
    );
    expect(audited).toContainEqual(
      expect.objectContaining({ action: "plugin.permissions_approved", detail: "added: files:private" }),
    );
  });

  it("does not record an approval for an unchanged update", async () => {
    installMarketplacePackage.mockResolvedValueOnce(installed([]));
    await updateExtension("site-1", "plugin", "acme.forms", { version: "1.1.0" });
    expect(audited.map((entry) => entry.action)).not.toContain("plugin.permissions_approved");
  });

  it("rejects a malformed approval", async () => {
    const res = await fetch(`${base}/api/marketplace/update`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "plugin", id: "acme.forms", approvedPermissions: "files:private" }),
    });
    expect(res.status).toBe(400);
    expect(installMarketplacePackage).not.toHaveBeenCalled();
  });
});
