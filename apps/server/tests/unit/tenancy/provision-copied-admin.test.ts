// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  query: vi.fn(),
  run: vi.fn(),
  gate: vi.fn(),
  action: vi.fn(),
  hashPassword: vi.fn(),
  readWorkspaceAdministrator: vi.fn(),
}));

vi.mock("../../../src/lib/database/db.js", () => ({
  getControlDb: async () => m,
  createDbClient: vi.fn(),
  runWithDatabase: <T>(_client: unknown, fn: () => T) => fn(),
}));
vi.mock("../../../src/lib/plugins/plugin-runtime.js", () => ({ getRuntimeHooks: () => ({ dispatchGate: m.gate, dispatchAction: m.action }) }));
vi.mock("../../../src/lib/auth/password.js", () => ({ hashPassword: m.hashPassword }));
vi.mock("../../../src/lib/tenancy/site-users.js", () => ({ readWorkspaceAdministrator: m.readWorkspaceAdministrator }));
vi.mock("../../../src/lib/tenancy/quotas.js", () => ({ enforceQuota: async () => null, applyQuotaDefaults: async () => undefined }));
vi.mock("../../../src/lib/tenancy/saas-settings.js", () => ({ platformBaseDomain: async () => "" }));
vi.mock("../../../src/lib/installation/install-defaults.js", () => ({ freshInstallSiteSettings: () => [], siteSettingsInsertSql: () => "INSERT settings" }));
vi.mock("../../../src/lib/themes/themes-db.js", () => ({ ensureDefaultTheme: async () => undefined }));
vi.mock("@justflows/content", () => ({ seedAccountPage: async () => undefined, seedAuthPages: async () => undefined }));

const { createAdditionalSite } = await import("../../../src/lib/tenancy/provision.js");

const TENANT = "11111111-1111-4111-8111-111111111111";
const FROM_SITE = "22222222-2222-4222-8222-222222222222";
const FROM_USER = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.resetAllMocks();
  process.env.DB_DRIVER = "postgres";
  m.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM tenants")) {
      return [{ id: TENANT, user_mode: "isolated", database_mode: "current", status: "active", name: "Workspace", slug: "workspace" }];
    }
    return [];
  });
});

function input(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    name: "Site B",
    hostname: "site-b.localhost",
    databaseChoice: "current" as const,
    adminFrom: { siteId: FROM_SITE, userId: FROM_USER },
    actorId: "operator",
    ...overrides,
  };
}

describe("adding an isolated site with an existing administrator", () => {
  it("seeds a copy of that administrator with the same password hash", async () => {
    m.readWorkspaceAdministrator.mockResolvedValue({
      ok: true,
      admin: { email: "dirk@example.com", username: "dirk", displayName: "Dirk", passwordHash: "$argon2id$copied" },
    });

    const result = await createAdditionalSite(input());

    expect(result.ok).toBe(true);
    expect(m.readWorkspaceAdministrator).toHaveBeenCalledWith(TENANT, FROM_SITE, FROM_USER);
    expect(m.hashPassword).not.toHaveBeenCalled();
    const insert = m.run.mock.calls.find(([sql]) => String(sql).startsWith("INSERT INTO users"));
    expect(insert?.[1]).toEqual([
      expect.any(String),
      expect.any(String),
      "dirk@example.com",
      "dirk",
      "Dirk",
      "$argon2id$copied",
      expect.any(String),
      expect.any(String),
    ]);
  });

  it("refuses before creating the site when the administrator is outside the workspace", async () => {
    m.readWorkspaceAdministrator.mockResolvedValue({ ok: false, status: 400, error: "That administrator is not part of this workspace." });

    const result = await createAdditionalSite(input());

    expect(result).toEqual({ ok: false, status: 400, error: "That administrator is not part of this workspace." });
    expect(m.run).not.toHaveBeenCalled();
  });

  it("refuses both an existing and a new administrator at once", async () => {
    const result = await createAdditionalSite(input({
      admin: { email: "new@example.com", username: "new", displayName: "New", password: "a-long-password" },
    }));

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(m.readWorkspaceAdministrator).not.toHaveBeenCalled();
    expect(m.run).not.toHaveBeenCalled();
  });
});
