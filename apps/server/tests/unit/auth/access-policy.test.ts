import { describe, expect, it, vi } from "vitest";
import { CAPABILITY_ID_PATTERN, getEffectiveAccess } from "../../../src/lib/auth/access-policy.js";
import type { DbClient } from "../../../src/lib/database/db.js";

vi.mock("../../../src/lib/plugins/plugin-runtime.js", () => ({
  getPluginLoader: () => null,
}));

function fakeDb(rows: Record<string, unknown>[]): DbClient {
  return {
    query: async () => rows,
  } as unknown as DbClient;
}

describe("CAPABILITY_ID_PATTERN", () => {
  it("accepts single-segment capability ids", () => {
    expect(CAPABILITY_ID_PATTERN.test("content:read")).toBe(true);
    expect(CAPABILITY_ID_PATTERN.test("users:manage")).toBe(true);
  });

  it("accepts multi-segment capability ids", () => {
    expect(CAPABILITY_ID_PATTERN.test("content:revisions:read")).toBe(true);
    expect(CAPABILITY_ID_PATTERN.test("content:revisions:restore")).toBe(true);
  });

  it("rejects ids with no colon or invalid characters", () => {
    expect(CAPABILITY_ID_PATTERN.test("content")).toBe(false);
    expect(CAPABILITY_ID_PATTERN.test("Content:Read")).toBe(false);
    expect(CAPABILITY_ID_PATTERN.test("content: read")).toBe(false);
  });
});

describe("getEffectiveAccess ownership defaults", () => {
  it("gives an author with no per-user row an implicit self-ownership scope", async () => {
    const access = await getEffectiveAccess("user-1", "site-1", "author", fakeDb([]));
    expect(access.policy.scopes?.["content:update"]).toEqual({ ownership: "self" });
  });

  it("keeps the implicit self-ownership default when a row exists only for grants/denies (no custom role)", async () => {
    // A row with role_id = null represents per-user grants/denies/scopes
    // layered on top of the built-in role, not a switch to a custom role —
    // the built-in role's implicit ownership default must still apply.
    const access = await getEffectiveAccess(
      "user-1",
      "site-1",
      "author",
      fakeDb([
        {
          role_id: null,
          grants_json: JSON.stringify(["media:delete"]),
          denies_json: "[]",
          scopes_json: "{}",
          capabilities_json: null,
        },
      ]),
    );
    expect(access.policy.scopes?.["content:update"]).toEqual({ ownership: "self" });
    expect(access.policy.grants).toContain("media:delete");
  });

  it("drops the implicit default once the user is switched to a custom role", async () => {
    const access = await getEffectiveAccess(
      "user-1",
      "site-1",
      "author",
      fakeDb([
        {
          role_id: "custom-role-1",
          grants_json: "[]",
          denies_json: "[]",
          scopes_json: "{}",
          capabilities_json: JSON.stringify(["content:read"]),
        },
      ]),
    );
    expect(access.policy.scopes?.["content:update"]).toBeUndefined();
  });

  it("lets an explicit scope override the implicit default", async () => {
    const access = await getEffectiveAccess(
      "user-1",
      "site-1",
      "author",
      fakeDb([
        {
          role_id: null,
          grants_json: "[]",
          denies_json: "[]",
          scopes_json: JSON.stringify({ "content:update": { ownership: "any" } }),
          capabilities_json: null,
        },
      ]),
    );
    expect(access.policy.scopes?.["content:update"]).toEqual({ ownership: "any" });
  });
});

describe("getEffectiveAccess additional roles", () => {
  function routedDb(extraRoles: string[]): DbClient {
    return {
      query: async (sql: string) =>
        /FROM user_additional_roles/i.test(sql) ? extraRoles.map((role) => ({ role })) : [],
    } as unknown as DbClient;
  }

  it("adds the capabilities of each additional role to the primary role's", async () => {
    const access = await getEffectiveAccess("user-1", "site-1", "subscriber", routedDb(["author"]));
    expect(access.roleId).toBe("subscriber");
    expect(access.roles).toEqual(["subscriber", "author"]);
    expect(access.capabilities).toEqual(expect.arrayContaining(["content:read", "content:create", "media:upload"]));
  });

  it("keeps an additional author limited to their own content", async () => {
    const access = await getEffectiveAccess("user-1", "site-1", "subscriber", routedDb(["author"]));
    expect(access.policy.scopes?.["content:update"]).toEqual({ ownership: "self" });
  });

  it("lets an editor who is also an author edit everything", async () => {
    const access = await getEffectiveAccess("user-1", "site-1", "editor", routedDb(["author"]));
    expect(access.policy.scopes?.["content:update"]).toBeUndefined();
  });

  it("never grants administrator through an additional role", async () => {
    const access = await getEffectiveAccess("user-1", "site-1", "subscriber", routedDb(["administrator"]));
    expect(access.additionalRoles).toEqual([]);
    expect(access.capabilities).not.toContain("users:manage");
  });

  it("ignores an additional role equal to the primary one", async () => {
    const access = await getEffectiveAccess("user-1", "site-1", "subscriber", routedDb(["subscriber"]));
    expect(access.roles).toEqual(["subscriber"]);
  });

  it("treats a missing table (pre-migration) as no additional roles", async () => {
    const db = {
      query: async (sql: string) => {
        if (/FROM user_additional_roles/i.test(sql)) throw new Error("relation does not exist");
        return [];
      },
    } as unknown as DbClient;
    const access = await getEffectiveAccess("user-1", "site-1", "subscriber", db);
    expect(access.roles).toEqual(["subscriber"]);
    expect(access.capabilities).toEqual(["content:read"]);
  });
});
