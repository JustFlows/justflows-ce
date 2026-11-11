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

const { listSiteUsers, listWorkspaceAdministrators, readWorkspaceAdministrator, withSiteUsers } = await import("../../../src/lib/tenancy/site-users.js");
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

describe("workspace administrators for a new isolated site", () => {
  /** Routes control-database queries by statement so each test only states the rows it cares about. */
  function controlRows(rows: { owned?: unknown[]; sites?: unknown[]; siteRows?: Record<string, unknown>; users?: unknown[] }) {
    control.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith("SELECT id FROM sites WHERE id = ? AND tenant_id = ?")) return rows.owned ?? [];
      if (sql.startsWith("SELECT id FROM sites WHERE tenant_id = ?")) return rows.sites ?? [];
      if (sql.includes("FROM sites s")) return [rows.siteRows?.[String(params[0])] ?? site({ id: params[0] })];
      if (sql.includes("FROM users")) return rows.users ?? [];
      return [];
    });
  }

  it("refuses an administrator from a site outside the workspace", async () => {
    controlRows({ owned: [] });

    const result = await readWorkspaceAdministrator("tenant-b", "site-other", "user-1");

    expect(result).toEqual({ ok: false, status: 400, error: "That administrator is not part of this workspace." });
    expect(borrowSeparateDatabase).not.toHaveBeenCalled();
  });

  it("copies the account and password hash from a site on a separate database", async () => {
    controlRows({ owned: [{ id: "site-b" }] });
    separateDatabaseForSite.mockResolvedValue(separateRow);
    borrowSeparateDatabase.mockResolvedValue(separateClient);
    separateClient.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (!sql.includes("FROM users")) return [];
      expect(sql).toContain("role = 'administrator'");
      expect(params).toEqual(["user-1", "site-b"]);
      return [{ email: "Owner@Example.com", username: "owner", display_name: "Owner", password_hash: "$argon2id$hash" }];
    });

    const result = await readWorkspaceAdministrator("tenant-b", "site-b", "user-1");

    expect(result).toEqual({
      ok: true,
      admin: { email: "owner@example.com", username: "owner", displayName: "Owner", passwordHash: "$argon2id$hash" },
    });
  });

  it("refuses a user who is not an administrator on that site", async () => {
    controlRows({ owned: [{ id: "site-b" }], siteRows: { "site-b": site({ database_choice: "inherit" }) }, users: [] });

    const result = await readWorkspaceAdministrator("tenant-b", "site-b", "editor-1");

    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("lists each administrator email once and skips unreachable sites", async () => {
    controlRows({
      sites: [{ id: "site-a" }, { id: "site-down" }, { id: "site-c" }],
      siteRows: {
        "site-a": site({ id: "site-a", name: "Site A", database_choice: "inherit" }),
        "site-down": site({ id: "site-down", name: "Down" }),
        "site-c": site({ id: "site-c", name: "Site C", database_choice: "inherit" }),
      },
    });
    separateDatabaseForSite.mockResolvedValue(separateRow);
    borrowSeparateDatabase.mockRejectedValue(new Error("ECONNREFUSED"));
    let call = 0;
    const usersBySite = [
      [{ id: "u-a", email: "Dirk@example.com", username: "dirk", display_name: "Dirk" }],
      [
        { id: "u-c1", email: "dirk@example.com", username: "dirk", display_name: "Dirk" },
        { id: "u-c2", email: "sam@example.com", username: "sam", display_name: "Sam" },
      ],
    ];
    const base = control.query.getMockImplementation()!;
    control.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("FROM users")) return usersBySite[call++] ?? [];
      return base(sql, params);
    });

    const result = await listWorkspaceAdministrators("tenant-b");

    expect(result).toEqual([
      { siteId: "site-a", siteName: "Site A", userId: "u-a", email: "dirk@example.com", username: "dirk", displayName: "Dirk" },
      { siteId: "site-c", siteName: "Site C", userId: "u-c2", email: "sam@example.com", username: "sam", displayName: "Sam" },
    ]);
  });
});
