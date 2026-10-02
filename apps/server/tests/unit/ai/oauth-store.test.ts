// SPDX-License-Identifier: MIT
import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteDb } from "./sqlite-db.js";

process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../../../src/lib/database/db.js", () => ({ getDb: async () => state.db }));
const audit = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../../src/lib/security/audit-log.js", () => ({ auditLog: audit }));

const store = await import("../../../src/lib/ai/oauth/oauth-store.js");

const SITE = "site-1";
const USER = "user-1";
const RESOURCE = "https://example.com/api/mcp";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function consent(capabilities = ["content:read", "content:create"]) {
  const { client } = await store.registerClient({ siteId: SITE, clientName: "Claude", redirectUris: [REDIRECT] });
  const { verifier, challenge } = pkce();
  const { code, grantId } = await store.issueAuthorizationCode({
    siteId: SITE,
    client,
    userId: USER,
    capabilities,
    userTools: false,
    redirectUri: REDIRECT,
    codeChallenge: challenge,
    resource: RESOURCE,
  });
  return { client, code, verifier, grantId };
}

beforeEach(async () => {
  const db = createSqliteDb();
  await db.run("INSERT INTO users (id, site_id, role, email) VALUES (?, ?, 'editor', 'e@example.com')", [USER, SITE]);
  state.db = db;
  audit.mockClear();
});

describe("redirect URI validation", () => {
  it("accepts https, loopback http and private-use schemes", () => {
    expect(store.validateRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect")).toBeTruthy();
    expect(store.validateRedirectUri("http://localhost:33418/callback")).toBeTruthy();
    expect(store.validateRedirectUri("http://127.0.0.1:6274/oauth/callback")).toBeTruthy();
    expect(store.validateRedirectUri("cursor://anysphere.cursor-retrieval/oauth/callback")).toBeTruthy();
  });

  it("rejects plain http on a public host, dangerous schemes, fragments and credentials", () => {
    for (const bad of [
      "http://evil.example/cb",
      "javascript:alert(1)",
      "data:text/html,hi",
      "https://example.com/cb#frag",
      "https://user:pass@example.com/cb",
      "not a url",
    ]) {
      expect(() => store.validateRedirectUri(bad), bad).toThrow(store.OAuthError);
    }
  });
});

describe("authorization requests", () => {
  it("round-trips a signed request and rejects tampering", () => {
    const signed = store.signAuthorizationRequest({
      clientId: "jfc_x",
      redirectUri: REDIRECT,
      codeChallenge: "c".repeat(43),
      state: "s",
      resource: RESOURCE,
      scope: null,
    });
    expect(store.verifyAuthorizationRequest(signed)?.redirectUri).toBe(REDIRECT);
    const [payload, mac] = signed.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload!, "base64url").toString()), redirectUri: "https://evil.example/cb" }),
    ).toString("base64url");
    expect(store.verifyAuthorizationRequest(`${forged}.${mac}`)).toBeNull();
  });
});

describe("authorization code exchange", () => {
  it("issues hashed, resource-bound tokens for a valid code + PKCE verifier", async () => {
    const { client, code, verifier, grantId } = await consent();
    const tokens = await store.exchangeAuthorizationCode({ client, code, redirectUri: REDIRECT, codeVerifier: verifier });
    expect(tokens.access_token.startsWith(store.ACCESS_TOKEN_PREFIX)).toBe(true);
    expect(tokens.refresh_token.startsWith(store.REFRESH_TOKEN_PREFIX)).toBe(true);

    // Nothing stored in plaintext.
    const rows = await (state.db as ReturnType<typeof createSqliteDb>).query<{ token_hash: string }>("SELECT token_hash FROM oauth_tokens");
    expect(rows.map((r) => r.token_hash)).not.toContain(tokens.access_token);
    expect(rows.map((r) => r.token_hash)).toContain(store.hashToken(tokens.access_token));

    const verified = await store.verifyAccessToken(tokens.access_token, RESOURCE);
    expect(verified?.grant.id).toBe(grantId);
    expect(verified?.grant.capabilities).toEqual(["content:read", "content:create"]);
    expect(verified?.role).toBe("editor");
    // Audience check: a token for the MCP resource is useless anywhere else.
    expect(await store.verifyAccessToken(tokens.access_token, "https://example.com/api/manage/v1")).toBeNull();
  });

  it("rejects a wrong PKCE verifier", async () => {
    const { client, code } = await consent();
    await expect(
      store.exchangeAuthorizationCode({ client, code, redirectUri: REDIRECT, codeVerifier: pkce().verifier }),
    ).rejects.toMatchObject({ code: "invalid_grant", message: "PKCE verification failed" });
  });

  it("rejects a redirect_uri that does not exactly match", async () => {
    const { client, code, verifier } = await consent();
    await expect(
      store.exchangeAuthorizationCode({ client, code, redirectUri: `${REDIRECT}/`, codeVerifier: verifier }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("rejects a code presented by another client", async () => {
    const { code, verifier } = await consent();
    const { client: other } = await store.registerClient({ siteId: SITE, clientName: "Other", redirectUris: [REDIRECT] });
    await expect(
      store.exchangeAuthorizationCode({ client: other, code, redirectUri: REDIRECT, codeVerifier: verifier }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("makes codes single-use and revokes the grant when one is replayed", async () => {
    const { client, code, verifier } = await consent();
    const tokens = await store.exchangeAuthorizationCode({ client, code, redirectUri: REDIRECT, codeVerifier: verifier });
    await expect(
      store.exchangeAuthorizationCode({ client, code, redirectUri: REDIRECT, codeVerifier: verifier }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    expect(await store.verifyAccessToken(tokens.access_token, RESOURCE)).toBeNull();
  });

  it("rejects an expired code", async () => {
    const { client, code, verifier } = await consent();
    await (state.db as ReturnType<typeof createSqliteDb>).run("UPDATE oauth_codes SET expires_at = '2000-01-01 00:00:00'");
    await expect(
      store.exchangeAuthorizationCode({ client, code, redirectUri: REDIRECT, codeVerifier: verifier }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });
});

describe("refresh token rotation", () => {
  it("rotates on use and revokes the whole grant when an old refresh token is reused", async () => {
    const { client, code, verifier } = await consent();
    const first = await store.exchangeAuthorizationCode({ client, code, redirectUri: REDIRECT, codeVerifier: verifier });
    const second = await store.refreshAccessToken({ client, refreshToken: first.refresh_token });
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(await store.verifyAccessToken(second.access_token, RESOURCE)).not.toBeNull();

    // Reuse of the rotated token: refused, and every token of the grant dies.
    await expect(store.refreshAccessToken({ client, refreshToken: first.refresh_token })).rejects.toMatchObject({
      code: "invalid_grant",
    });
    expect(await store.verifyAccessToken(second.access_token, RESOURCE)).toBeNull();
    await expect(store.refreshAccessToken({ client, refreshToken: second.refresh_token })).rejects.toMatchObject({
      code: "invalid_grant",
    });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "oauth.refresh_reuse" }));
  });
});

describe("revocation", () => {
  it("revoking a grant cuts off its access tokens immediately", async () => {
    const { client, code, verifier, grantId } = await consent();
    const tokens = await store.exchangeAuthorizationCode({ client, code, redirectUri: REDIRECT, codeVerifier: verifier });
    expect(await store.verifyAccessToken(tokens.access_token, RESOURCE)).not.toBeNull();
    await store.revokeGrant(grantId);
    expect(await store.verifyAccessToken(tokens.access_token, RESOURCE)).toBeNull();
    expect(await store.listGrants(SITE, { userId: USER })).toEqual([]);
  });

  it("RFC 7009 revocation of a refresh token ends the grant", async () => {
    const { client, code, verifier } = await consent();
    const tokens = await store.exchangeAuthorizationCode({ client, code, redirectUri: REDIRECT, codeVerifier: verifier });
    await store.revokeToken(client, tokens.refresh_token);
    expect(await store.verifyAccessToken(tokens.access_token, RESOURCE)).toBeNull();
  });

  it("a removed user's tokens stop working", async () => {
    const { client, code, verifier } = await consent();
    const tokens = await store.exchangeAuthorizationCode({ client, code, redirectUri: REDIRECT, codeVerifier: verifier });
    await (state.db as ReturnType<typeof createSqliteDb>).run("DELETE FROM users");
    expect(await store.verifyAccessToken(tokens.access_token, RESOURCE)).toBeNull();
  });
});

describe("confidential clients", () => {
  it("authenticates by secret and never stores it in plaintext", async () => {
    const { client, clientSecret } = await store.registerClient({
      siteId: SITE,
      clientName: "Server app",
      redirectUris: [REDIRECT],
      tokenEndpointAuthMethod: "client_secret_post",
    });
    expect(clientSecret).toBeTruthy();
    expect(await store.authenticateClient(client, clientSecret!)).toBe(true);
    expect(await store.authenticateClient(client, "jfcs_wrong")).toBe(false);
    expect(await store.authenticateClient(client, undefined)).toBe(false);
    const rows = await (state.db as ReturnType<typeof createSqliteDb>).query<{ client_secret_hash: string }>(
      "SELECT client_secret_hash FROM oauth_clients",
    );
    expect(rows[0]?.client_secret_hash).not.toBe(clientSecret);
  });
});
