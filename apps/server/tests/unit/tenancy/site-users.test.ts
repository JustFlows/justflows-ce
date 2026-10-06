import { beforeEach, describe, expect, it, vi } from "vitest";

const control = { query: vi.fn(), run: vi.fn() };
const separateClient = { query: vi.fn(), run: vi.fn() };
const separateRow = { id: "db-1" };
const separateDatabaseForSite = vi.fn();
const borrowSeparateDatabase = vi.fn();
const listUsers = vi.fn();

vi.mock("../../../src/lib/database/db.js", async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  const store = new AsyncLocalStorage<unknown>();
  return {
    getControlDb: async () => control,
    getDb: async () => store.getStore() ?? control,
    runWithDatabase: <T>(client: unknown, fn: () => T) => store.run(client, fn),
  };
});
vi.mock("../../../src/lib/tenancy/connections.js", () => ({ separateDatabaseForSite, borrowSeparateDatabase }));
vi.mock("../../../src/lib/auth/users-admin.js", () => ({
  listUsers,
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  emitUserEvent: vi.fn(),
  getUserWithAccess: vi.fn(),
  updateUser: vi.fn(),
}));
vi.mock("../../../src/lib/auth/assignable-roles.js", () => ({
  listAssignableRoles: async () => [{ id: "administrator", label: "Administrator" }],
}));

const { listSiteUsers, withSiteUsers } = await import("../../../src/lib/tenancy/site-users.js");
const { getDb } = await import("../../../src/lib/database/db.js");
const { getTenantContext } = await import("../../../src/lib/tenancy/context.js");

function site(overrides: Record<string, unknown> = {}) {
  return {
    id: "site-b",
    name: "Site B",
    status: "active",
    tenant_id: "tenant-b",
    tenant_name: "Workspace B",
    database_choice: "separate",
    user_mode: "isolated",
    database_mode: "current",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  separateClient.query.mockResolvedValue([{ plugin_id: "shop" }]);
});

describe("site users for platform operators", () => {
  it("reads users from the site's separate database inside that site's context", async () => {
    control.query.mockResolvedValueOnce([site()]);
    separateDatabaseForSite.mockResolvedValue(separateRow);
    borrowSeparateDatabase.mockResolvedValue(separateClient);
    listUsers.mockImplementation(async () => {
      expect(await getDb()).toBe(separateClient);
      expect(getTenantContext()?.siteId).toBe("site-b");
      expect([...(getTenantContext()?.activePluginIds ?? [])]).toEqual(["shop"]);
      return [{ id: "u1", email: "a@example.com" }];
    });

    const result = await listSiteUsers("site-b");

    expect(result.status).toBe(200);
    expect(listUsers).toHaveBeenCalledWith("site-b");
    expect(result.body).toMatchObject({ users: [{ id: "u1" }], site: { separateDatabase: true, userMode: "isolated" } });
  });

  it("refuses instead of falling back when the separate database is unreachable", async () => {
    control.query.mockResolvedValueOnce([site()]);
    separateDatabaseForSite.mockResolvedValue(separateRow);
    borrowSeparateDatabase.mockRejectedValue(new Error("ECONNREFUSED"));
    const fn = vi.fn();

    const result = await withSiteUsers("site-b", fn);

    expect(result).toEqual({ ok: false, status: 502, error: "This website's database is not reachable." });
    expect(fn).not.toHaveBeenCalled();
  });

  it("uses the installation database for a site on the current database", async () => {
    control.query.mockResolvedValueOnce([site({ database_choice: "inherit" })]).mockResolvedValue([]);
    const result = await withSiteUsers("site-b", async () => getDb());

    expect(separateDatabaseForSite).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, value: control });
  });

  it("returns 404 for an unknown site and 409 while provisioning", async () => {
    control.query.mockResolvedValueOnce([]);
    expect(await withSiteUsers("missing", vi.fn())).toMatchObject({ ok: false, status: 404 });
    control.query.mockResolvedValueOnce([site({ status: "provisioning" })]);
    expect(await withSiteUsers("site-b", vi.fn())).toMatchObject({ ok: false, status: 409 });
  });
});
