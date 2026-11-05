// SPDX-License-Identifier: MIT

import { PackageRejectedError } from "@justflows/installer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const audited: Array<{ action: string; detail?: string }> = [];
const installMarketplacePackage = vi.fn();
const insertPlugin = vi.fn();

vi.mock("../../../src/lib/settings/site-settings.js", () => ({
  getSiteId: async () => "site-1",
  getSiteSetting: async () => ({ plugin: ["acme.forms"], theme: [] }),
  setSiteSetting: async () => undefined,
}));
vi.mock("../../../src/lib/security/audit-log.js", () => ({
  auditLog: async (entry: { action: string; detail?: string }) => {
    audited.push(entry);
  },
}));
vi.mock("../../../src/lib/tenancy/registry.js", () => ({ isInstallationRootSite: async () => true }));
vi.mock("../../../src/lib/plugins/plugins-db.js", () => ({
  getPlugin: async () => ({ status: "active", version: "1.0.0", manifest: {} }),
  insertPlugin,
  listPlugins: async () => [{ id: "acme.forms", name: "Forms", version: "1.0.0" }],
  markPluginError: async () => undefined,
}));
vi.mock("../../../src/lib/themes/themes-db.js", () => ({ listThemes: async () => [] }));
vi.mock("../../../src/lib/extensions/marketplace-package.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  installMarketplacePackage,
}));

const { PluginPermissionApprovalError } = await import(
  "../../../src/lib/plugins/plugin-permission-approval.js"
);
const updates = await import("../../../src/lib/extensions/extension-updates.js");

beforeEach(() => {
  audited.length = 0;
  vi.clearAllMocks();
});

describe("automatic plugin updates", () => {
  it("skips an update that needs approval rather than failing or applying it", async () => {
    const cause = new PluginPermissionApprovalError("acme.forms", "Forms", ["files:private"]);
    installMarketplacePackage.mockRejectedValue(new PackageRejectedError(cause.message, cause));
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({
        items: [
          { type: "plugin", id: "acme.forms", version: "1.1.0", registry: { listed: true, free: true } },
        ],
      }),
    );

    await updates.runExtensionAutoUpdate();

    expect(installMarketplacePackage).toHaveBeenCalledOnce();
    expect(insertPlugin).not.toHaveBeenCalled();
    expect(audited).toContainEqual(
      expect.objectContaining({
        action: "extension.auto_update_skipped",
        detail: "1.0.0 -> 1.1.0 (new permissions need manual approval)",
      }),
    );
    expect(audited.map((entry) => entry.action)).not.toContain("extension.auto_update_failed");
  });
});
