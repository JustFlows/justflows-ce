// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deactivatePluginAdmin } from "../../../src/lib/plugins/plugins-admin.js";

const mocks = vi.hoisted(() => ({
  runtimeDeactivate: vi.fn(),
  persistInactive: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
  isRoot: vi.fn(),
  othersActive: vi.fn(),
}));
vi.mock("../../../src/lib/plugins/plugin-runtime.js", () => ({
  runtimeDeactivatePlugin: mocks.runtimeDeactivate,
}));
vi.mock("../../../src/lib/plugins/plugins-db.js", () => ({
  deactivatePlugin: mocks.persistInactive,
  activatePlugin: vi.fn(), getPlugin: vi.fn(), markPluginError: vi.fn(), pluginToDto: vi.fn(),
}));
vi.mock("../../../src/lib/tenancy/registry.js", () => ({ isInstallationRootSite: mocks.isRoot }));
vi.mock("../../../src/lib/plugins/plugin-multisite.js", () => ({ otherSitesHaveActivePlugin: mocks.othersActive }));
vi.mock("../../../src/lib/security/audit-log.js", () => ({ auditLog: mocks.audit }));
vi.mock("../../../src/lib/cache/cache-revalidate.js", () => ({ revalidateOnUpdate: mocks.revalidate }));
const actor = { siteId: "site-1", userId: "admin-1", role: "administrator" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.isRoot.mockResolvedValue(true);
  mocks.othersActive.mockResolvedValue(false);
});

describe("deactivatePluginAdmin", () => {
  it("finishes runtime deactivation before persisting inactive status", async () => {
    mocks.persistInactive.mockImplementation(async () => {
      expect(mocks.runtimeDeactivate).toHaveBeenCalledWith("site-1", "shop");
    });
    expect(await deactivatePluginAdmin("shop", actor)).toEqual({ status: 200, body: { ok: true } });
    expect(mocks.persistInactive).toHaveBeenCalledWith("site-1", "shop");
  });

  it("does not persist or report success when runtime deactivation fails", async () => {
    mocks.runtimeDeactivate.mockRejectedValue(new Error("runtime deactivation failed"));
    await expect(deactivatePluginAdmin("shop", actor)).rejects.toThrow("runtime deactivation failed");
    expect(mocks.persistInactive).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("keeps the shared module loaded when another site still has the plugin on", async () => {
    mocks.othersActive.mockResolvedValue(true);
    expect(await deactivatePluginAdmin("shop", actor)).toEqual({ status: 200, body: { ok: true } });
    expect(mocks.othersActive).toHaveBeenCalledWith("shop", "site-1");
    expect(mocks.runtimeDeactivate).not.toHaveBeenCalled();
    expect(mocks.persistInactive).toHaveBeenCalledWith("site-1", "shop");
  });

  it("only turns off its own row when a sub-site deactivates", async () => {
    mocks.isRoot.mockResolvedValue(false);
    expect(await deactivatePluginAdmin("shop", actor)).toEqual({ status: 200, body: { ok: true } });
    expect(mocks.runtimeDeactivate).not.toHaveBeenCalled();
    expect(mocks.persistInactive).toHaveBeenCalledWith("site-1", "shop");
  });
});
