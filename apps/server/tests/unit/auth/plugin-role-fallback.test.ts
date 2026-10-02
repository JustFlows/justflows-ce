// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectivePrimaryRole } from "../../../src/lib/auth/plugin-role-fallback.js";
import { getEffectiveAccess } from "../../../src/lib/auth/access-policy.js";
import { resolveSession } from "../../../src/lib/auth/auth-session.js";
import type { Request, Response } from "express";
import type { DbClient } from "../../../src/lib/database/db.js";

const state = vi.hoisted(() => ({ active: true, defaultRole: "subscriber", cookieRole: "customer" }));
vi.mock("../../../src/lib/plugins/plugin-runtime.js", () => ({
  getPluginLoader: () => ({
    roleRegistry: {
      all: () => state.active ? [{ id: "customer", pluginId: "shop", capabilities: ["media:upload"] }] : [],
      get: (id: string) => state.active && id === "customer" ? { capabilities: ["media:upload"] } : undefined,
    },
    capabilityRegistry: { all: () => [] },
  }),
}));
vi.mock("../../../src/lib/settings/general-settings.js", () => ({
  getGeneralSettings: async () => ({ defaultRole: state.defaultRole }),
}));

vi.mock("../../../src/lib/database/db.js", () => ({
  getDb: async () => ({ query: async () => [{ role: "customer", email: "user@example.com", token_version: 0 }] }),
}));
vi.mock("../../../src/lib/auth/session.js", () => ({
  getSession: () => ({ userId: "user-1", siteId: "site-1", role: state.cookieRole, email: "user@example.com", tv: 0, iat: 0 }),
  setSessionCookie: (_res: unknown, session: { role: string }) => { state.cookieRole = session.role; },
}));

beforeEach(() => { state.active = true; state.defaultRole = "subscriber"; });

function dbWithAdditionalRoles(roles: string[]) {
  return {
    query: vi.fn(async (sql: string) => sql.includes("FROM user_additional_roles") ? roles.map(role => ({ role })) : []),
    run: vi.fn(),
  };
}

describe("inactive plugin roles", () => {
  it("refreshes an existing session to the default and back to Customer on reactivation", async () => {
    state.cookieRole = "customer";
    state.active = false;
    const req = {} as Request;
    const res = {} as Response;
    expect((await resolveSession(req, res))?.role).toBe("subscriber");
    expect(state.cookieRole).toBe("subscriber");
    state.active = true;
    expect((await resolveSession(req, res))?.role).toBe("customer");
    expect(state.cookieRole).toBe("customer");
  });

  it("temporarily uses the configured default and restores the stored primary role on reactivation", async () => {
    const db = dbWithAdditionalRoles([]);
    const access = () => getEffectiveAccess("user-1", "site-1", "customer", db as unknown as DbClient);
    expect((await access()).roles).toEqual(["customer"]);
    state.active = false;
    state.defaultRole = "contributor";
    const disabled = await access();
    expect(disabled.roleId).toBe("contributor");
    expect(disabled.roles).toEqual(["contributor"]);
    expect(disabled.policy.scopes?.["content:update"]).toEqual({ ownership: "self" });
    state.active = true;
    expect((await access()).roles).toEqual(["customer"]);
    expect(db.run).not.toHaveBeenCalled();
  });

  it("suspends additional roles without deleting them or changing the primary role", async () => {
    const db = dbWithAdditionalRoles(["customer"]);
    const access = () => getEffectiveAccess("user-1", "site-1", "subscriber", db as unknown as DbClient);
    expect((await access()).additionalRoles).toEqual(["customer"]);
    state.active = false;
    const disabled = await access();
    expect(disabled.roles).toEqual(["subscriber"]);
    expect(disabled.capabilities).not.toContain("media:upload");
    state.active = true;
    expect((await access()).additionalRoles).toEqual(["customer"]);
    expect(db.run).not.toHaveBeenCalled();
  });

  it("leaves core primary roles intact while the plugin is disabled", async () => {
    state.active = false;
    expect(await effectivePrimaryRole("site-1", "administrator")).toBe("administrator");
  });
});
