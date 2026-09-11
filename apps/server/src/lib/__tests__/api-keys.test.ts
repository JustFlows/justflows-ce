// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";

/** In-memory stand-in for the api_keys / users tables. */
const keyRows = new Map<string, Record<string, unknown>>();
let ownerRole = "administrator";

const INSERT_COLUMNS = [
  "id",
  "site_id",
  "name",
  "key_prefix",
  "key_hash",
  "owner_user_id",
  "created_by",
  "capabilities_json",
  "scopes_json",
  "allowed_ips_json",
  "allowed_origins_json",
  "rate_limit_per_min",
  "expires_at",
  "created_at",
  "updated_at",
];

const fakeDb = {
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (/FROM users/i.test(sql)) {
      return [{ role: ownerRole }] as unknown as T[];
    }
    if (/WHERE key_hash = \?/i.test(sql)) {
      for (const row of keyRows.values()) {
        if (row.key_hash === params[0]) return [row] as unknown as T[];
      }
      return [] as T[];
    }
    if (/WHERE id = \? AND site_id = \?/i.test(sql)) {
      const row = keyRows.get(String(params[0]));
      return row && row.site_id === params[1] ? ([row] as unknown as T[]) : ([] as T[]);
    }
    if (/FROM api_keys WHERE site_id = \?/i.test(sql)) {
      return [...keyRows.values()].filter((r) => r.site_id === params[0]) as unknown as T[];
    }
    return [] as T[];
  },
  async run(sql: string, params: unknown[] = []): Promise<void> {
    if (/^INSERT INTO api_keys/i.test(sql)) {
      const row: Record<string, unknown> = {
        revoked_at: null,
        last_used_at: null,
        last_used_ip: null,
        request_count: 0,
      };
      INSERT_COLUMNS.forEach((col, i) => (row[col] = params[i] ?? null));
      keyRows.set(String(row.id), row);
      return;
    }
    if (/^UPDATE api_keys SET/i.test(sql)) {
      const id = String(params[params.length - 2]);
      const row = keyRows.get(id);
      if (!row) return;
      const assignments = sql
        .slice(sql.indexOf("SET") + 3, sql.indexOf("WHERE"))
        .split(",")
        .map((s) => s.trim().split("=")[0]!.trim());
      assignments.forEach((col, i) => {
        if (col === "request_count") row[col] = Number(row[col] ?? 0) + 1;
        else row[col] = params[i] ?? null;
      });
      return;
    }
    if (/^DELETE FROM api_keys/i.test(sql)) {
      keyRows.delete(String(params[0]));
      return;
    }
    // UPDATE webhook_endpoints ... — no-op in this fake.
  },
  async close(): Promise<void> {},
};

vi.mock("../db.js", () => ({ getDb: async () => fakeDb, resetDb: () => {} }));

let ownerCapabilities: string[] = [
  "content:read",
  "content:create",
  "content:update",
  "media:read",
];
vi.mock("../access-policy.js", () => ({
  getEffectiveAccess: async () => ({
    roleId: ownerRole,
    capabilities: ownerCapabilities,
    policy: { grants: [], denies: [], scopes: {} },
  }),
}));

const {
  API_KEY_TOKEN_PREFIX,
  ApiKeyError,
  createApiKey,
  generateApiKeySecret,
  hashApiKey,
  keyCan,
  rotateApiKey,
  revokeApiKey,
  verifyApiKey,
} = await import("../api-keys.js");

const owner = { userId: "u1", siteId: "s1", role: "administrator" };

beforeEach(() => {
  keyRows.clear();
  ownerRole = "administrator";
  ownerCapabilities = ["content:read", "content:create", "content:update", "media:read"];
});

describe("secret generation", () => {
  it("is a CSPRNG token with the jfk_ prefix and stores only a hash", () => {
    const { secret, keyPrefix, keyHash } = generateApiKeySecret();
    expect(secret.startsWith(API_KEY_TOKEN_PREFIX)).toBe(true);
    expect(secret.length).toBeGreaterThan(40);
    expect(keyPrefix.startsWith(API_KEY_TOKEN_PREFIX)).toBe(true);
    expect(secret).not.toContain(keyHash);
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(secret)).toBe(keyHash);
  });

  it("never repeats a token", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateApiKeySecret().secret));
    expect(seen.size).toBe(50);
  });
});

describe("capability ceiling at creation", () => {
  it("accepts a subset of the creator's capabilities", async () => {
    const { record } = await createApiKey({
      siteId: "s1",
      name: "reader",
      owner,
      capabilities: ["content:read", "media:read"],
    });
    expect(record.capabilities).toEqual(["content:read", "media:read"]);
  });

  it("rejects a capability the creator lacks", async () => {
    await expect(
      createApiKey({
        siteId: "s1",
        name: "too much",
        owner,
        capabilities: ["content:read", "users:manage"],
      }),
    ).rejects.toBeInstanceOf(ApiKeyError);
  });
});

describe("verifyApiKey", () => {
  it("resolves a good secret and rejects a tampered one", async () => {
    const { secret } = await createApiKey({
      siteId: "s1",
      name: "k",
      owner,
      capabilities: ["content:read"],
    });
    const ok = await verifyApiKey(secret);
    expect(ok?.owner).toEqual({ userId: "u1", siteId: "s1", role: "administrator" });
    expect(ok?.rejection).toBeNull();
    expect(await verifyApiKey(`${secret}x`)).toBeNull();
    expect(await verifyApiKey("not-a-key")).toBeNull();
  });

  it("flags a revoked key without hiding which key it was", async () => {
    const { record, secret } = await createApiKey({
      siteId: "s1",
      name: "k",
      owner,
      capabilities: ["content:read"],
    });
    await revokeApiKey("s1", record.id);
    const verified = await verifyApiKey(secret);
    expect(verified?.rejection).toBe("revoked");
    expect(verified?.record.id).toBe(record.id);
  });

  it("flags an expired key", async () => {
    const { secret } = await createApiKey({
      siteId: "s1",
      name: "k",
      owner,
      capabilities: ["content:read"],
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect((await verifyApiKey(secret))?.rejection).toBe("expired");
  });
});

describe("keyCan — per-request intersection with the owner's current access", () => {
  it("allows a capability the key and the owner both hold", async () => {
    const { record } = await createApiKey({
      siteId: "s1",
      name: "k",
      owner,
      capabilities: ["content:read", "content:update"],
    });
    expect(await keyCan(record, owner, "content:read")).toBe(true);
  });

  it("denies a capability the key does not carry", async () => {
    const { record } = await createApiKey({
      siteId: "s1",
      name: "k",
      owner,
      capabilities: ["content:read"],
    });
    expect(await keyCan(record, owner, "content:update")).toBe(false);
  });

  it("is neutered when the owner loses the capability", async () => {
    const { record } = await createApiKey({
      siteId: "s1",
      name: "k",
      owner,
      capabilities: ["content:read", "content:update"],
    });
    ownerCapabilities = ["media:read"]; // owner's role/policy changed
    expect(await keyCan(record, owner, "content:read")).toBe(false);
    expect(await keyCan(record, owner, "content:update")).toBe(false);
  });

  it("enforces an ownership:self scope on the resource", async () => {
    const { record } = await createApiKey({
      siteId: "s1",
      name: "k",
      owner,
      capabilities: ["content:update"],
      scope: { ownership: "self" },
    });
    expect(await keyCan(record, owner, "content:update", { ownerId: "u1" })).toBe(true);
    expect(await keyCan(record, owner, "content:update", { ownerId: "u2" })).toBe(false);
  });

  it("enforces a contentType scope", async () => {
    const { record } = await createApiKey({
      siteId: "s1",
      name: "k",
      owner,
      capabilities: ["content:read"],
      scope: { contentTypes: ["post"] },
    });
    expect(await keyCan(record, owner, "content:read", { contentType: "post" })).toBe(true);
    expect(await keyCan(record, owner, "content:read", { contentType: "page" })).toBe(false);
  });
});

describe("rotate and revoke take effect immediately", () => {
  it("rotate invalidates the old secret and issues a new one", async () => {
    const { record, secret } = await createApiKey({
      siteId: "s1",
      name: "k",
      owner,
      capabilities: ["content:read"],
    });
    const rotated = await rotateApiKey("s1", record.id);
    expect(rotated?.secret).not.toBe(secret);
    expect(await verifyApiKey(secret)).toBeNull();
    expect((await verifyApiKey(rotated!.secret))?.rejection).toBeNull();
  });
});
