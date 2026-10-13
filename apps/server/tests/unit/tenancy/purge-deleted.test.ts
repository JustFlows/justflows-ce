// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn(), run: vi.fn(), create: vi.fn(), contentRun: vi.fn(), close: vi.fn(), release: vi.fn(), contentQuery: vi.fn(), gate: vi.fn(), action: vi.fn(), storage: vi.fn(), rm: vi.fn(), uploads: vi.fn(), exports: vi.fn() }));
vi.mock("node:fs/promises", () => ({ default: { rm: m.rm } }));
vi.mock("../../../src/lib/media/upload-store.js", () => ({ getUploadStore: () => ({ deletePrefix: m.uploads }) }));
vi.mock("../../../src/lib/static-export/object-storage.js", () => ({ staticExportDriver: () => "s3", clearDeployedStaticExport: m.exports }));
vi.mock("../../../src/lib/database/db.js", () => ({ getControlDb: async () => ({ execute: m.execute, query: m.query, run: m.run }), createDbClient: m.create, runWithDatabase: async (_db: unknown, fn: () => Promise<unknown>) => fn() }));
vi.mock("../../../src/lib/security/secret-box.js", () => ({ decryptSecret: () => "test-password" }));
vi.mock("../../../src/lib/domains/custom-domains.js", () => ({ releaseSitesAtProvider: m.release }));
vi.mock("../../../src/lib/plugins/plugin-runtime.js", () => ({ getRuntimeHooks: () => ({ dispatchGate: m.gate, dispatchAction: m.action }) }));
vi.mock("../../../src/lib/plugins/plugin-purge.js", () => ({ purgePluginStorage: m.storage }));
import { purgeDeletedTenant } from "../../../src/lib/tenancy/purge-deleted.js";
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DB_DRIVER", "mariadb");
  vi.stubEnv("DB_NAME", "justflows");
  m.execute.mockResolvedValue(1);
  m.contentQuery.mockResolvedValue([]);
  m.query.mockResolvedValue([]);
  m.storage.mockResolvedValue({ ok: true });
  m.query.mockResolvedValueOnce([{ id, slug: "customer", status: "suspended" }])
    .mockResolvedValueOnce([{ id: "invalid-file-id", url: "https://customer.example.com" }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ host: "localhost", port: 3306, database_name: "customers", username: "justflows", password_ciphertext: "encrypted" }])
    .mockResolvedValueOnce([{ count: 1 }]);
  m.create.mockResolvedValue({ run: m.contentRun, query: m.contentQuery, close: m.close });
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
  it("retains registry records when remote uploads cannot be removed", async () => {
    m.query.mockReset().mockResolvedValue([]).mockResolvedValueOnce([{ id, slug: "customer", status: "suspended" }]).mockResolvedValueOnce([{ id, url: "https://customer.example.com" }]);
    m.uploads.mockRejectedValue(new Error("storage unavailable"));
    await expect(purgeDeletedTenant(id, null)).rejects.toThrow("storage unavailable");
    expect(m.run).not.toHaveBeenCalled();
    expect(m.uploads).toHaveBeenCalledWith(`${id}/`);
  });
  it("removes only the site's remote static-export namespace", async () => {
    m.query.mockReset().mockResolvedValue([]).mockResolvedValueOnce([{ id, slug: "customer", status: "suspended" }]).mockResolvedValueOnce([{ id, url: "https://customer.example.com" }]);
    expect((await purgeDeletedTenant(id, null)).ok).toBe(true);
    expect(m.exports).toHaveBeenCalledWith(id);
  });
  it("does not remove a workspace reactivated since the initial read", async () => {
    m.execute.mockResolvedValue(0);
    expect((await purgeDeletedTenant(id, null)).ok).toBe(false);
    expect(m.gate).not.toHaveBeenCalled();
    expect(m.run).not.toHaveBeenCalled();
  });
  it("blocks removal when the required plugin gate fails", async () => {
    m.gate.mockRejectedValue(new Error("provider unavailable"));
    await expect(purgeDeletedTenant(id, null)).rejects.toThrow("provider unavailable");
    expect(m.release).not.toHaveBeenCalled();
    expect(m.run).not.toHaveBeenCalled();
  });
  it("keeps records for retry when domain-provider release fails", async () => {
    m.release.mockRejectedValue(new Error("domain provider unavailable"));
    await expect(purgeDeletedTenant(id, null)).rejects.toThrow("domain provider unavailable");
    expect(m.run).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });
  it("cleans recorded plugin tables without dropping shared tables", async () => {
    m.contentQuery.mockResolvedValue([{ plugin_id: "justflows.shop" }]);
    expect(await purgeDeletedTenant(id, null)).toEqual({ ok: true, tenantId: id });
    expect(m.storage).toHaveBeenCalledWith("invalid-file-id", "justflows.shop", { rowsOnly: true, strictRemote: true, driver: "mariadb" });
    expect(m.run).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM job_queue"), [id]);
    expect(m.action).toHaveBeenCalledWith("workspace.purged", { tenantId: id }, { source: "system" });
  });
  it("preserves records when plugin data cannot be removed", async () => {
    m.contentQuery.mockResolvedValue([{ plugin_id: "justflows.shop" }]);
    m.storage.mockResolvedValue({ ok: false });
    await expect(purgeDeletedTenant(id, null)).rejects.toThrow("Plugin data could not be removed");
    expect(m.run).not.toHaveBeenCalled();
  });
  it("keeps root cleanup strict", async () => {
    m.run.mockRejectedValue({ code: "ER_NO_SUCH_TABLE" });
    await expect(purgeDeletedTenant(id, null)).rejects.toEqual({ code: "ER_NO_SUCH_TABLE" });
    expect(m.run).toHaveBeenCalledTimes(1);
  });
});
