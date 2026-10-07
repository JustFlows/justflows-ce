// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  users: new Map<string, string>(),
  policies: new Map<string, Record<string, unknown>>(),
  roles: new Map<string, string[]>(),
  run: vi.fn(async () => undefined),
  execute: vi.fn(async () => 1),
}));

const client = vi.hoisted(() => ({
  async query(sql: string, params: unknown[] = []) {
    if (sql.includes("FROM user_access_policies")) {
      const row = db.policies.get(String(params[0]));
      if (!row) return [];
      const roleId = row.role_id as string | null;
      return [{ ...row, capabilities_json: roleId ? JSON.stringify(db.roles.get(roleId) ?? []) : null }];
    }
    if (sql.includes("FROM access_roles")) {
      const caps = db.roles.get(String(params[0]));
      return caps ? [{ id: params[0], capabilities_json: JSON.stringify(caps) }] : [];
    }
    if (sql.startsWith("SELECT role FROM users")) {
      const role = db.users.get(String(params[0]));
      return role ? [{ role }] : [];
    }
    if (sql.includes("COUNT(*)")) return [{ count: 2 }];
    return [];
  },
  run: (...args: unknown[]) => db.run(...(args as [])),
  execute: (...args: unknown[]) => db.execute(...(args as [])),
  transaction: async (fn: (tx: unknown) => Promise<void>) => fn({ run: db.run }),
}));

vi.mock("../../../src/lib/database/db.js", () => ({ getDb: async () => client }));
vi.mock("../../../src/lib/plugins/plugin-runtime.js", () => ({
  getPluginLoader: () => null,
  getRuntimeHooks: () => ({ dispatchAction: async () => undefined }),
}));
vi.mock("../../../src/lib/security/audit-log.js", () => ({ auditLog: async () => undefined }));
vi.mock("../../../src/lib/auth/auth-session.js", () => ({ revokeUserSessions: async () => undefined }));
vi.mock("../../../src/lib/auth/plugin-role-fallback.js", () => ({
  effectivePrimaryRole: async (_site: string, role: string) => role,
}));
vi.mock("../../../src/lib/settings/general-settings.js", () => ({
  getGeneralSettings: async () => ({ defaultRole: "subscriber" }),
}));
vi.mock("../../../src/lib/tenancy/quotas.js", () => ({ enforceQuota: async () => null }));
vi.mock("../../../src/lib/http/webhooks.js", () => ({ emitWebhookEvent: async () => undefined }));

import { createUser, deleteUser, updateUser } from "../../../src/lib/auth/users-admin.js";
import { createRole, updateRole } from "../../../src/lib/auth/roles-admin.js";

const manager = { siteId: "site-1", userId: "mgr", role: "subscriber" };

beforeEach(() => {
  db.users.clear();
  db.policies.clear();
  db.roles.clear();
  db.run.mockClear();
  db.users.set("mgr", "subscriber");
  db.users.set("other", "subscriber");
  db.users.set("admin", "administrator");
  db.roles.set("user-manager", ["users:read", "users:manage"]);
  db.policies.set("mgr", { role_id: "user-manager", grants_json: "[]", denies_json: "[]", scopes_json: "{}" });
});

describe("delegated user management", () => {
  it("cannot promote its own primary role to administrator", async () => {
    const result = await updateUser("mgr", { role: "administrator" }, manager);
    expect(result.status).toBe(403);
    expect(db.run).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE users SET role"), expect.anything());
  });

  it("cannot promote another account it controls or create an administrator", async () => {
    expect((await updateUser("other", { role: "administrator" }, manager)).status).toBe(403);
    expect((await updateUser("other", { role: "editor" }, manager)).status).toBe(403);
    expect((await updateUser("other", { grants: ["settings:manage"] }, manager)).status).toBe(403);
    const created = await createUser(
      { email: "x@example.com", username: "xx", displayName: "X", password: "a-Long-passw0rd!", role: "administrator" },
      manager,
    );
    expect(created.status).toBe(403);
  });

  it("cannot change or delete an administrator", async () => {
    expect((await updateUser("admin", { role: "subscriber" }, manager)).status).toBe(403);
    expect((await deleteUser("admin", manager)).status).toBe(403);
  });

  it("can still assign roles within its own access and the site's default role", async () => {
    expect((await updateUser("other", { roleId: "user-manager" }, manager)).status).toBe(200);
    expect((await updateUser("other", { role: "subscriber" }, manager)).status).toBe(200);
  });

  it("cannot widen a custom role beyond its own access", async () => {
    expect((await updateRole("user-manager", { name: "UM", capabilities: ["users:manage", "settings:manage"] }, manager)).status).toBe(403);
    expect((await createRole({ name: "Root", capabilities: ["settings:manage"] }, manager)).status).toBe(403);
  });

  it("limits an administrator's API key to the key's own capabilities", async () => {
    const keyActor = { siteId: "site-1", userId: "admin", role: "administrator", capabilityCeiling: ["users:manage", "users:read"] };
    expect((await updateUser("other", { role: "administrator" }, keyActor)).status).toBe(403);
    expect((await updateUser("other", { role: "administrator" }, { siteId: "site-1", userId: "admin", role: "administrator" })).status).toBe(200);
  });

  it("cannot hand out a capability it only holds within a scope", async () => {
    db.roles.set("scoped-manager", ["users:read", "users:manage", "content:update"]);
    db.policies.set("mgr", {
      role_id: "scoped-manager",
      grants_json: "[]",
      denies_json: "[]",
      scopes_json: JSON.stringify({ "content:update": { ownership: "self" } }),
    });
    const widen = { grants: ["content:update"], scopes: { "content:update": { ownership: "any" as const } } };
    expect((await updateUser("other", widen, manager)).status).toBe(403);
    expect((await updateUser("mgr", widen, manager)).status).toBe(400); // own policy is never self-editable
    expect((await updateUser("other", { grants: ["content:update"] }, manager)).status).toBe(403);
    expect((await createRole({ name: "Editors", capabilities: ["content:update"] }, manager)).status).toBe(403);
    // Unscoped capabilities stay delegable.
    expect((await updateUser("other", { grants: ["users:read"] }, manager)).status).toBe(200);
  });

  it("treats a scoped API key as unable to delegate anything beyond the default role", async () => {
    const keyActor = {
      siteId: "site-1",
      userId: "admin",
      role: "administrator",
      capabilityCeiling: ["users:manage", "users:read", "content:update"],
      scopeCeiling: { contentTypes: ["post"] },
    };
    expect((await updateUser("other", { grants: ["content:update"] }, keyActor)).status).toBe(403);
    expect((await updateUser("other", { role: "subscriber" }, keyActor)).status).toBe(200);
  });

  it("does not turn the default role into grantable capabilities", async () => {
    // subscriber is the default role; its capabilities are not the manager's own.
    expect((await updateUser("other", { grants: ["content:read"] }, manager)).status).toBe(403);
  });
});
