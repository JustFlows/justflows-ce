// SPDX-License-Identifier: MIT

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb, resetDb } from "../../../src/lib/database/db.js";
import { runAllMigrations, type DbDriver } from "../../../src/lib/database/run-migrations.js";

vi.mock("../../../src/lib/security/audit-log.js", () => ({ auditLog: vi.fn(async () => {}) }));
vi.mock("../../../src/lib/ai/ai-settings.js", () => ({ allowPrivateAiEndpoints: async () => false }));

/**
 * 0036_ai_byok on a real engine: applied to fixture tables, re-run
 * idempotently, then the OAuth, credential and usage stores against it.
 *
 * Opt-in, against a disposable database only:
 *
 *   AI_TEST_DATABASE=1 DB_NAME=ai_test DB_DRIVER=postgres|mysql|mariadb \
 *     DB_HOST=… DB_USER=… DB_PASSWORD=… pnpm --filter @justflows/server exec \
 *     vitest run tests/integration/database/ai-byok-migration.integration.test.ts
 */
const enabled = process.env.AI_TEST_DATABASE === "1" && process.env.DB_NAME === "ai_test";

describe.skipIf(!enabled)("0036_ai_byok migration", () => {
  const siteId = randomUUID();
  const userId = randomUUID();
  const driver = process.env.DB_DRIVER as DbDriver;
  process.env.APP_SECRET ??= "test-secret-that-is-at-least-32-characters-long";

  beforeAll(async () => {
    const db = await getDb();
    // Model the tables 0036 alters or references, then apply the real
    // migration on its own (the same approach as the scheduling test).
    const pg = driver === "postgres";
    const uuid = pg ? "UUID" : "CHAR(36)";
    const suffix = pg ? "" : " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
    await db.run(`CREATE TABLE IF NOT EXISTS sites (id ${uuid} PRIMARY KEY, name TEXT, url TEXT)${suffix}`);
    await db.run(
      `CREATE TABLE IF NOT EXISTS users (id ${uuid} PRIMARY KEY, site_id ${uuid}, email TEXT, username TEXT, display_name TEXT, password_hash TEXT, role VARCHAR(32))${suffix}`,
    );
    await db.run(`CREATE TABLE IF NOT EXISTS api_keys (id VARCHAR(36) PRIMARY KEY, site_id ${uuid})${suffix}`);
    await db.run(`CREATE TABLE IF NOT EXISTS revisions (id ${uuid} PRIMARY KEY, content_id ${uuid})${suffix}`);
    await runAllMigrations(db, driver, ["0036_ai_byok"]);
    // Idempotent re-run: already recorded.
    expect((await runAllMigrations(db, driver, ["0036_ai_byok"])).applied).toEqual([]);
    await db.run("INSERT INTO sites (id, name, url) VALUES (?, 'AI test', ?)", [siteId, `https://${siteId}.example`]);
    await db.run(
      "INSERT INTO users (id, site_id, email, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, 'AI tester', 'unused', 'administrator')",
      [userId, siteId, `${userId}@example.com`, userId.slice(0, 20)],
    );
  });

  afterAll(async () => {
    const db = await getDb();
    await db.run("DELETE FROM sites WHERE id = ?", [siteId]).catch(() => undefined);
    resetDb();
  });

  it("re-applies the 0036 DDL without error when it was not recorded (crash mid-run)", async () => {
    const db = await getDb();
    await db.run("DELETE FROM _migrations WHERE name = ?", ["0036_ai_byok"]);
    expect((await runAllMigrations(db, driver, ["0036_ai_byok"])).applied).toEqual(["0036_ai_byok"]);
  });

  it("adds the attribution and opt-in columns", async () => {
    const db = await getDb();
    await db.query("SELECT via, via_client FROM revisions WHERE 1 = 0");
    await db.query("SELECT mcp_user_tools FROM api_keys WHERE 1 = 0");
  });

  it("runs the OAuth flow, including refresh reuse detection, on this engine", async () => {
    const store = await import("../../../src/lib/ai/oauth/oauth-store.js");
    const redirect = "https://claude.ai/api/mcp/auth_callback";
    const resource = "https://example.com/api/mcp";
    const { client } = await store.registerClient({ siteId, clientName: "Claude", redirectUris: [redirect] });
    const verifier = randomBytes(32).toString("base64url");
    const { code } = await store.issueAuthorizationCode({
      siteId, client, userId, capabilities: ["content:read"], userTools: true, redirectUri: redirect,
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"), resource,
    });
    const first = await store.exchangeAuthorizationCode({ client, code, redirectUri: redirect, codeVerifier: verifier });
    expect((await store.verifyAccessToken(first.access_token, resource))?.grant.userTools).toBe(true);
    const second = await store.refreshAccessToken({ client, refreshToken: first.refresh_token });
    await expect(store.refreshAccessToken({ client, refreshToken: first.refresh_token })).rejects.toMatchObject({ code: "invalid_grant" });
    expect(await store.verifyAccessToken(second.access_token, resource)).toBeNull();
  });

  it("stores provider credentials encrypted and enforces one per scope and provider", async () => {
    const credentials = await import("../../../src/lib/ai/provider-credentials.js");
    await credentials.saveCredential({ siteId, scope: { kind: "site" }, provider: "anthropic", apiKey: "sk-ant-test-0000-wxyz", actorId: userId });
    await credentials.saveCredential({ siteId, scope: { kind: "user", userId }, provider: "anthropic", apiKey: "sk-ant-mine-0000-abcd", actorId: userId });
    await credentials.saveCredential({ siteId, scope: { kind: "site" }, provider: "anthropic", defaultModel: "claude", actorId: userId });
    const rows = await (await getDb()).query<{ api_key_enc: string }>("SELECT api_key_enc FROM ai_provider_credentials WHERE site_id = ?", [siteId]);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.api_key_enc.startsWith("enc:v1:"))).toBe(true);
    expect((await credentials.loadProviderConfig(siteId, { kind: "site" }, "anthropic"))?.apiKey).toBe("sk-ant-test-0000-wxyz");
  });

  it("records daily usage with an upsert that works on this engine", async () => {
    const usage = await import("../../../src/lib/ai/usage.js");
    await usage.recordUsage(siteId, userId, { requests: 1 });
    await usage.recordUsage(siteId, userId, { requests: 1, inputTokens: 10, outputTokens: 5 });
    const rows = await (await getDb()).query<{ requests: number; input_tokens: number }>(
      "SELECT requests, input_tokens FROM ai_usage_daily WHERE user_id = ?",
      [userId],
    );
    expect(Number(rows[0]?.requests)).toBe(2);
    expect(Number(rows[0]?.input_tokens)).toBe(10);
  });
});
