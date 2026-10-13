// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), purge: vi.fn() }));
vi.mock("../../../src/lib/database/db.js", () => ({ getControlDb: async () => ({ query: m.query }) }));
vi.mock("../../../src/lib/tenancy/purge-deleted.js", async (original) => ({ ...await original<object>(), purgeDeletedTenant: m.purge }));
vi.mock("../../../src/lib/jobs/core-jobs.js", () => ({ registerCoreJob: vi.fn() }));
import { purgeExpiredDeletedTenants } from "../../../src/lib/tenancy/purge-deleted-job.js";
beforeEach(() => vi.resetAllMocks());
describe("workspace retention", () => {
  it("includes suspended workspaces and continues after an individual failure", async () => {
    m.query.mockResolvedValueOnce([{ value: { purgeAfterDays: 30 } }]).mockResolvedValueOnce([
      { id: "failed", deletion_requested_at: "2020-01-01T00:00:00Z" },
      { id: "expired", deletion_requested_at: "2020-01-01 00:00:00" },
      { id: "recent", deletion_requested_at: new Date() },
    ]);
    m.purge.mockRejectedValueOnce(new Error("provider unavailable")).mockResolvedValueOnce({ ok: true });
    expect(await purgeExpiredDeletedTenants()).toEqual({ success: false, message: "Removed 1 deleted websites, 1 failed" });
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining("status IN ('deleted', 'suspended')"), expect.any(Array));
    expect(m.purge.mock.calls).toEqual([["failed", null], ["expired", null]]);
  });
  it("does not purge when retention is disabled", async () => {
    m.query.mockResolvedValueOnce([{ value: { purgeAfterDays: 0 } }]);
    expect((await purgeExpiredDeletedTenants()).success).toBe(true);
    expect(m.purge).not.toHaveBeenCalled();
    expect(m.query).toHaveBeenCalledTimes(1);
  });
});
