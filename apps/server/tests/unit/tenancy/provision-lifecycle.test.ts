// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), run: vi.fn(), execute: vi.fn(), gate: vi.fn(), action: vi.fn(), purge: vi.fn() }));
vi.mock("../../../src/lib/database/db.js", () => ({ getControlDb: async () => m, createDbClient: vi.fn(), runWithDatabase: vi.fn() }));
vi.mock("../../../src/lib/plugins/plugin-runtime.js", () => ({ getRuntimeHooks: () => ({ dispatchGate: m.gate, dispatchAction: m.action }) }));
vi.mock("../../../src/lib/tenancy/purge-deleted.js", () => ({ purgeDeletedTenant: m.purge }));
import { suspendTenant, reactivateTenant, deleteTenant } from "../../../src/lib/tenancy/provision.js";
beforeEach(() => { vi.resetAllMocks(); m.query.mockResolvedValue([{ id: "workspace", database_mode: "current" }]); m.execute.mockResolvedValue(1); });
describe("workspace lifecycle", () => {
  it("records suspension for retention and dispatches plugin lifecycle hooks", async () => {
    expect((await suspendTenant("workspace", "owner")).ok).toBe(true);
    expect(m.run).toHaveBeenCalledWith(expect.stringContaining("deletion_requested_at = COALESCE(deletion_requested_at, ?)"), [expect.any(String), expect.any(String), "workspace"]);
    expect(m.gate).toHaveBeenCalledWith("workspace.beforeSuspend", { tenantId: "workspace" }, { source: "system" });
    expect(m.action).toHaveBeenCalledWith("workspace.suspended", { tenantId: "workspace" }, { source: "system" });
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining("slug <> 'primary'"), ["workspace"]);
  });
  it("clears the deletion marker on reactivation", async () => {
    expect((await reactivateTenant("workspace", "owner")).ok).toBe(true);
    expect(m.execute).toHaveBeenCalledWith(expect.stringContaining("deletion_requested_at = NULL"), [expect.any(String), "workspace"]);
  });
  it("does not reactivate sites after purge has claimed the workspace", async () => {
    m.execute.mockResolvedValue(0);
    expect((await reactivateTenant("workspace", "owner")).ok).toBe(false);
    expect(m.run).not.toHaveBeenCalled();
    expect(m.action).not.toHaveBeenCalled();
  });
  it("uses the full safe purge path for immediate removal", async () => {
    m.purge.mockResolvedValue({ ok: true, tenantId: "workspace" });
    expect((await deleteTenant("workspace", "owner", true)).ok).toBe(true);
    expect(m.action).toHaveBeenCalledWith("workspace.deleted", { tenantId: "workspace", dropDatabase: true }, { source: "system" });
    expect(m.purge).toHaveBeenCalledWith("workspace", "owner");
  });
  it("does not change status when required plugin cleanup fails", async () => {
    m.gate.mockRejectedValue(new Error("cleanup unavailable"));
    await expect(suspendTenant("workspace", "owner")).rejects.toThrow("cleanup unavailable");
    expect(m.run).not.toHaveBeenCalled();
  });
});
