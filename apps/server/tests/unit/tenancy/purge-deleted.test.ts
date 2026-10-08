// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), run: vi.fn(), create: vi.fn(), contentRun: vi.fn(), close: vi.fn(), release: vi.fn() }));
vi.mock("../../../src/lib/database/db.js", () => ({ getControlDb: async () => ({ query: m.query, run: m.run }), createDbClient: m.create }));
vi.mock("../../../src/lib/security/secret-box.js", () => ({ decryptSecret: () => "test-password" }));
vi.mock("../../../src/lib/domains/custom-domains.js", () => ({ releaseSitesAtProvider: m.release }));
import { purgeDeletedTenant } from "../../../src/lib/tenancy/purge-deleted.js";
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DB_DRIVER", "mariadb");
  vi.stubEnv("DB_NAME", "justflows");
  m.query.mockResolvedValueOnce([{ id, slug: "customer", status: "suspended" }])
    .mockResolvedValueOnce([{ id: "invalid-file-id", url: "https://customer.example.com" }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ host: "localhost", port: 3306, database_name: "customers", username: "justflows", password_ciphertext: "encrypted" }])
    .mockResolvedValueOnce([{ count: 1 }]);
  m.create.mockResolvedValue({ run: m.contentRun, close: m.close });
});
afterEach(() => vi.unstubAllEnvs());
describe("permanent workspace deletion", () => {
  it.each(["ER_NO_SUCH_TABLE", "42P01"])("removes root records when separate tables are missing (%s)", async (code) => {
    m.contentRun.mockRejectedValue({ code });
    expect(await purgeDeletedTenant(id, null)).toEqual({ ok: true, tenantId: id });
    expect(m.contentRun).toHaveBeenCalledWith("DELETE FROM tenants WHERE id = ?", [id]);
    expect(m.run).toHaveBeenCalledWith("DELETE FROM sites WHERE id = ?", ["invalid-file-id"]);
    expect(m.run).toHaveBeenCalledWith("DELETE FROM tenants WHERE id = ?", [id]);
    expect(m.run).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO platform_audit"), expect.any(Array));
    expect(m.close).toHaveBeenCalledOnce();
    expect(m.release).toHaveBeenCalledWith(["invalid-file-id"]);
  });
  it("continues deleting tenant rows when only sites is missing", async () => {
    m.contentRun.mockRejectedValueOnce({ code: "ER_NO_SUCH_TABLE" }).mockResolvedValueOnce(undefined);
    expect(await purgeDeletedTenant(id, null)).toEqual({ ok: true, tenantId: id });
    expect(m.contentRun).toHaveBeenCalledTimes(2);
  });
  it.each(["ER_BAD_DB_ERROR", "3D000"])("removes root records when the separate database is missing (%s)", async (code) => {
    m.create.mockRejectedValue({ code });
    expect(await purgeDeletedTenant(id, null)).toEqual({ ok: true, tenantId: id });
    expect(m.run).toHaveBeenCalledWith("DELETE FROM tenants WHERE id = ?", [id]);
  });
  it.each(["ER_TABLEACCESS_DENIED_ERROR", "ECONNREFUSED", "23503"])("preserves root records for other content errors (%s)", async (code) => {
    m.contentRun.mockRejectedValue({ code });
    await expect(purgeDeletedTenant(id, null)).rejects.toEqual({ code });
    expect(m.run).not.toHaveBeenCalled();
    expect(m.close).toHaveBeenCalledOnce();
  });
  it("keeps root cleanup strict", async () => {
    m.run.mockRejectedValue({ code: "ER_NO_SUCH_TABLE" });
    await expect(purgeDeletedTenant(id, null)).rejects.toEqual({ code: "ER_NO_SUCH_TABLE" });
    expect(m.run).toHaveBeenCalledTimes(1);
  });
});
