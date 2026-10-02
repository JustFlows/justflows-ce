// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deactivatePluginAdmin } from "../../../src/lib/plugins/plugins-admin.js";

const mocks = vi.hoisted(() => ({
  runtimeDeactivate: vi.fn(),
  persistInactive: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("../../../src/lib/plugins/plugin-runtime.js", () => ({
  runtimeDeactivatePlugin: mocks.runtimeDeactivate,
}));
vi.mock("../../../src/lib/plugins/plugins-db.js", () => ({
  deactivatePlugin: mocks.persistInactive,
  activatePlugin: vi.fn(), getPlugin: vi.fn(), markPluginError: vi.fn(), pluginToDto: vi.fn(),
}));
vi.mock("../../../src/lib/security/audit-log.js", () => ({ auditLog: mocks.audit }));
vi.mock("../../../src/lib/cache/cache-revalidate.js", () => ({ revalidateOnUpdate: mocks.revalidate }));
const actor = { siteId: "site-1", userId: "admin-1", role: "administrator" };

beforeEach(() => vi.resetAllMocks());

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
});
