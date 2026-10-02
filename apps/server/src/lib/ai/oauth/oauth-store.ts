// SPDX-License-Identifier: MIT

import { createHash, createHmac, hkdfSync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { UserCapability } from "@justflows/sdk";
import { getDb } from "../../database/db.js";
import { auditLog } from "../../security/audit-log.js";

/**
 * OAuth 2.1 authorization server state for MCP (#159).
 *
 * Scope is deliberately narrow: this is the authorization server for the MCP
 * endpoint (and agent-facing use of `/api/manage/v1`), not a general
 * third-party app platform.
 *
 * - Clients register dynamically (RFC 7591). Public clients use PKCE only.
 * - Authorization codes are single-use, live five minutes, and require PKCE
 *   S256. Presenting a used code revokes the grant it came from.
 * - Access tokens live one hour. Refresh tokens rotate on every use; presenting
 *   one that was already rotated revokes the whole grant (reuse detection).
 * - Every code, token and client secret is stored only as a SHA-256 hash.
 * - Every token is bound to a resource (the MCP URL) and checked against it.
 */

export const ACCESS_TOKEN_PREFIX = "jfo_at_";
export const REFRESH_TOKEN_PREFIX = "jfo_rt_";
const CODE_PREFIX = "jfo_ac_";
const CLIENT_ID_PREFIX = "jfc_";
const CLIENT_SECRET_PREFIX = "jfcs_";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const CODE_TTL_SECONDS = 5 * 60;
const AUTH_REQUEST_TTL_SECONDS = 10 * 60;

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

function sqlTime(value: Date = new Date()): string {
  return value.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  const asDate = new Date(`${String(value).replace(" ", "T")}${/[zZ]|[+-]\d\d:?\d\d$/.test(String(value)) ? "" : "Z"}`);
  return Number.isNaN(asDate.getTime()) ? String(value) : asDate.toISOString();
}

/**
 * Expiry is decided in SQL (`LIVE_SQL`), comparing the stored value with a
 * `sqlTime()` string in the same statement. Both sides are then read in the
 * session's time zone, so the check is right on every engine even when the
 * server's zone is not UTC — parsing the returned value in JavaScript is not.
 */
function liveSql(column: string): string {
  return `CASE WHEN ${column} > ? THEN 1 ELSE 0 END AS live`;
}

function isLive(row: Record<string, unknown>): boolean {
  return row.live === true || Number(row.live) === 1;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function token(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function parseJsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function truthy(value: unknown): boolean {
  return value === true || Number(value) === 1;
}

/* -------------------------------- clients -------------------------------- */

export interface OAuthClient {
  id: string;
  siteId: string;
  clientId: string;
  clientName: string;
  clientUri: string | null;
  redirectUris: string[];
  tokenEndpointAuthMethod: "none" | "client_secret_post" | "client_secret_basic";
  hasSecret: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "about:", "blob:", "ftp:"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * A redirect URI a client may register: HTTPS anywhere, plain HTTP only on a
 * loopback host (native apps, RFC 8252 §7.3), or a private-use scheme such as
 * `cursor://` (§7.1). No fragments, no credentials.
 */
export function validateRedirectUri(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2000) {
    throw new OAuthError("invalid_redirect_uri", "Redirect URI is missing or too long");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthError("invalid_redirect_uri", "Redirect URI must be an absolute URI");
  }
  if (url.hash) throw new OAuthError("invalid_redirect_uri", "Redirect URI must not contain a fragment");
  if (url.username || url.password) throw new OAuthError("invalid_redirect_uri", "Redirect URI must not contain credentials");
  if (BLOCKED_SCHEMES.has(url.protocol)) throw new OAuthError("invalid_redirect_uri", "Redirect URI scheme is not allowed");
  if (url.protocol === "http:" && !LOOPBACK.has(url.hostname)) {
    throw new OAuthError("invalid_redirect_uri", "Plain HTTP redirect URIs are only allowed on localhost");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:" && !/^[a-z][a-z0-9+.-]{1,60}:$/.test(url.protocol)) {
    throw new OAuthError("invalid_redirect_uri", "Redirect URI scheme is not allowed");
  }
  return value;
}

function rowToClient(row: Record<string, unknown>): OAuthClient {
  const method = String(row.token_endpoint_auth_method);
  return {
    id: String(row.id),
    siteId: String(row.site_id),
    clientId: String(row.client_id),
    clientName: String(row.client_name),
    clientUri: row.client_uri == null ? null : String(row.client_uri),
    redirectUris: parseJsonArray(row.redirect_uris_json),
    tokenEndpointAuthMethod:
      method === "client_secret_post" || method === "client_secret_basic" ? method : "none",
    hasSecret: row.client_secret_hash != null && String(row.client_secret_hash) !== "",
    createdAt: toIso(row.created_at) ?? "",
    lastUsedAt: toIso(row.last_used_at),
  };
}

export interface RegisterClientInput {
  siteId: string;
  clientName: string;
  redirectUris: string[];
  clientUri?: string | null;
  tokenEndpointAuthMethod?: string;
}

export async function registerClient(input: RegisterClientInput): Promise<{ client: OAuthClient; clientSecret: string | null }> {
  const redirectUris = [...new Set(input.redirectUris)];
  if (redirectUris.length === 0 || redirectUris.length > 10) {
    throw new OAuthError("invalid_redirect_uri", "Register between one and ten redirect URIs");
  }
  redirectUris.forEach(validateRedirectUri);
  const method =
    input.tokenEndpointAuthMethod === "client_secret_post" || input.tokenEndpointAuthMethod === "client_secret_basic"
      ? input.tokenEndpointAuthMethod
      : input.tokenEndpointAuthMethod === undefined || input.tokenEndpointAuthMethod === "none"
        ? "none"
        : null;
  if (!method) throw new OAuthError("invalid_client_metadata", "Unsupported token_endpoint_auth_method");
  let clientUri: string | null = null;
  if (input.clientUri) {
    try {
      const url = new URL(input.clientUri);
      if (url.protocol === "https:" || url.protocol === "http:") clientUri = url.toString().slice(0, 500);
    } catch {
      // Ignore an unusable client_uri rather than failing registration.
    }
  }
  const name = input.clientName.replace(/[\r\n\0<>]/g, " ").trim().slice(0, 120) || "MCP client";
  const clientId = `${CLIENT_ID_PREFIX}${randomBytes(16).toString("base64url")}`;
  const clientSecret = method === "none" ? null : token(CLIENT_SECRET_PREFIX);
  const id = randomUUID();
  await (
    await getDb()
  ).run(
    `INSERT INTO oauth_clients
       (id, site_id, client_id, client_secret_hash, client_name, client_uri, redirect_uris_json,
        token_endpoint_auth_method, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.siteId, clientId, clientSecret ? hashToken(clientSecret) : null, name, clientUri, JSON.stringify(redirectUris), method, sqlTime()],
  );
  const client = await getClientByClientId(clientId);
  if (!client) throw new OAuthError("server_error", "Client could not be registered", 500);
  return { client, clientSecret };
}

export async function getClientByClientId(clientId: string): Promise<OAuthClient | null> {
  if (typeof clientId !== "string" || !clientId.startsWith(CLIENT_ID_PREFIX) || clientId.length > 64) return null;
  const rows = await (
    await getDb()
  ).query<Record<string, unknown>>("SELECT * FROM oauth_clients WHERE client_id = ? LIMIT 1", [clientId]);
  return rows[0] ? rowToClient(rows[0]) : null;
}

/** Authenticate a confidential client; public clients pass with no secret. */
export async function authenticateClient(client: OAuthClient, secret: string | undefined): Promise<boolean> {
  if (client.tokenEndpointAuthMethod === "none") return true;
  if (!secret) return false;
  const rows = await (
    await getDb()
  ).query<{ client_secret_hash: string | null }>("SELECT client_secret_hash FROM oauth_clients WHERE id = ? LIMIT 1", [
    client.id,
  ]);
  const stored = rows[0]?.client_secret_hash;
  if (!stored) return false;
  const a = Buffer.from(stored, "hex");
  const b = Buffer.from(hashToken(secret), "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/* -------------------------- authorization requests ----------------------- */

/**
 * A pending authorization request, carried through the login and consent
 * screens as an HMAC-signed, short-lived blob instead of server state. The
 * consent endpoint re-validates the client and redirect URI from the database
 * before issuing anything.
 */
export interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  resource: string;
  scope: string | null;
  exp: number;
}

function requestKey(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) throw new Error("APP_SECRET must be at least 32 characters");
  return Buffer.from(hkdfSync("sha256", secret, "justflows-oauth", "authorization-request", 32));
}

export function signAuthorizationRequest(request: Omit<AuthorizationRequest, "exp">): string {
  const payload = Buffer.from(
    JSON.stringify({ ...request, exp: Math.floor(Date.now() / 1000) + AUTH_REQUEST_TTL_SECONDS }),
  ).toString("base64url");
  const mac = createHmac("sha256", requestKey()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function verifyAuthorizationRequest(value: unknown): AuthorizationRequest | null {
  if (typeof value !== "string" || value.length > 8_000) return null;
  const [payload, mac] = value.split(".");
  if (!payload || !mac) return null;
  const expected = createHmac("sha256", requestKey()).update(payload).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AuthorizationRequest;
    if (typeof parsed.exp !== "number" || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof parsed.clientId !== "string" || typeof parsed.redirectUri !== "string") return null;
    if (typeof parsed.codeChallenge !== "string" || typeof parsed.resource !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/* --------------------------------- grants -------------------------------- */

export interface OAuthGrant {
  id: string;
  siteId: string;
  clientRowId: string;
  clientId: string;
  clientName: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  capabilities: UserCapability[];
  userTools: boolean;
  resource: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const GRANT_SELECT = `SELECT g.*, c.client_id AS public_client_id, c.client_name, u.email AS user_email, u.display_name AS user_name
  FROM oauth_grants g
  JOIN oauth_clients c ON c.id = g.client_id
  LEFT JOIN users u ON u.id = g.user_id`;

function rowToGrant(row: Record<string, unknown>): OAuthGrant {
  return {
    id: String(row.id),
    siteId: String(row.site_id),
    clientRowId: String(row.client_id),
    clientId: String(row.public_client_id),
    clientName: String(row.client_name),
    userId: String(row.user_id),
    userEmail: row.user_email == null ? null : String(row.user_email),
    userName: row.user_name == null ? null : String(row.user_name),
    capabilities: parseJsonArray(row.capabilities_json) as UserCapability[],
    userTools: truthy(row.mcp_user_tools),
    resource: String(row.resource),
    createdAt: toIso(row.created_at) ?? "",
    lastUsedAt: toIso(row.last_used_at),
    revokedAt: toIso(row.revoked_at),
  };
}

export async function getGrant(id: string): Promise<OAuthGrant | null> {
  const rows = await (await getDb()).query<Record<string, unknown>>(`${GRANT_SELECT} WHERE g.id = ? LIMIT 1`, [id]);
  return rows[0] ? rowToGrant(rows[0]) : null;
}

export async function listGrants(siteId: string, filter: { userId?: string } = {}): Promise<OAuthGrant[]> {
  const params: string[] = [siteId];
  let sql = `${GRANT_SELECT} WHERE g.site_id = ? AND g.revoked_at IS NULL`;
  if (filter.userId) {
    sql += " AND g.user_id = ?";
    params.push(filter.userId);
  }
  sql += " ORDER BY g.created_at DESC";
  return (await (await getDb()).query<Record<string, unknown>>(sql, params)).map(rowToGrant);
}

export async function revokeGrant(grantId: string, reason: "user" | "admin" | "reuse" = "user"): Promise<boolean> {
  const db = await getDb();
  const grant = await getGrant(grantId);
  if (!grant) return false;
  const now = sqlTime();
  await db.run("UPDATE oauth_grants SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?", [now, grantId]);
  await db.run("UPDATE oauth_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE grant_id = ?", [now, grantId]);
  if (reason === "reuse") {
    void auditLog({
      siteId: grant.siteId,
      action: "oauth.refresh_reuse",
      outcome: "failure",
      actorId: grant.userId,
      target: grant.id,
      detail: `client=${grant.clientId}`,
    });
  }
  return true;
}

/* ------------------------------ codes & tokens --------------------------- */

export interface IssueCodeInput {
  siteId: string;
  client: OAuthClient;
  userId: string;
  capabilities: UserCapability[];
  userTools: boolean;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
}

/**
 * Record consent and mint an authorization code. One live grant per client and
 * user: consenting again replaces the earlier capability set.
 */
export async function issueAuthorizationCode(input: IssueCodeInput): Promise<{ code: string; grantId: string }> {
  const db = await getDb();
  const now = sqlTime();
  const existing = await db.query<{ id: string }>(
    "SELECT id FROM oauth_grants WHERE client_id = ? AND user_id = ? AND site_id = ? AND revoked_at IS NULL LIMIT 1",
    [input.client.id, input.userId, input.siteId],
  );
  let grantId = existing[0]?.id ? String(existing[0].id) : null;
  if (grantId) {
    await db.run("UPDATE oauth_grants SET capabilities_json = ?, mcp_user_tools = ?, resource = ? WHERE id = ?", [
      JSON.stringify([...new Set(input.capabilities)]),
      input.userTools,
      input.resource,
      grantId,
    ]);
  } else {
    grantId = randomUUID();
    await db.run(
      `INSERT INTO oauth_grants (id, site_id, client_id, user_id, capabilities_json, mcp_user_tools, resource, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [grantId, input.siteId, input.client.id, input.userId, JSON.stringify([...new Set(input.capabilities)]), input.userTools, input.resource, now],
    );
  }
  const code = token(CODE_PREFIX);
  await db.run(
    `INSERT INTO oauth_codes (code_hash, grant_id, redirect_uri, code_challenge, resource, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [hashToken(code), grantId, input.redirectUri, input.codeChallenge, input.resource, sqlTime(new Date(Date.now() + CODE_TTL_SECONDS * 1000)), now],
  );
  return { code, grantId };
}

export interface TokenPair {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

async function issueTokens(grantId: string, resource: string): Promise<TokenPair> {
  const db = await getDb();
  const access = token(ACCESS_TOKEN_PREFIX);
  const refresh = token(REFRESH_TOKEN_PREFIX);
  const now = new Date();
  await db.run(
    `INSERT INTO oauth_tokens (id, token_hash, kind, grant_id, resource, expires_at, created_at) VALUES (?, ?, 'access', ?, ?, ?, ?)`,
    [randomUUID(), hashToken(access), grantId, resource, sqlTime(new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000)), sqlTime(now)],
  );
  await db.run(
    `INSERT INTO oauth_tokens (id, token_hash, kind, grant_id, resource, expires_at, created_at) VALUES (?, ?, 'refresh', ?, ?, ?, ?)`,
    [randomUUID(), hashToken(refresh), grantId, resource, sqlTime(new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000)), sqlTime(now)],
  );
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: refresh, scope: "mcp" };
}

/** PKCE S256: BASE64URL(SHA256(code_verifier)) must equal the stored challenge. */
export function verifyPkce(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier, "ascii").digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export interface ExchangeCodeInput {
  client: OAuthClient;
  code: unknown;
  redirectUri: unknown;
  codeVerifier: unknown;
  resource?: unknown;
}

export async function exchangeAuthorizationCode(input: ExchangeCodeInput): Promise<TokenPair> {
  if (typeof input.code !== "string" || !input.code.startsWith(CODE_PREFIX)) {
    throw new OAuthError("invalid_grant", "Invalid authorization code");
  }
  const db = await getDb();
  const rows = await db.query<Record<string, unknown>>(
    `SELECT oc.*, g.client_id AS grant_client, g.revoked_at AS grant_revoked, ${liveSql("oc.expires_at")}
     FROM oauth_codes oc JOIN oauth_grants g ON g.id = oc.grant_id
     WHERE oc.code_hash = ? LIMIT 1`,
    [sqlTime(), hashToken(input.code)],
  );
  const row = rows[0];
  if (!row) throw new OAuthError("invalid_grant", "Invalid authorization code");
  const grantId = String(row.grant_id);
  if (row.used_at != null) {
    // A replayed code means it leaked: revoke everything issued from it.
    await revokeGrant(grantId, "reuse");
    throw new OAuthError("invalid_grant", "Invalid authorization code");
  }
  if (!isLive(row) || row.grant_revoked != null || String(row.grant_client) !== input.client.id) {
    throw new OAuthError("invalid_grant", "Invalid authorization code");
  }
  if (typeof input.redirectUri !== "string" || input.redirectUri !== String(row.redirect_uri)) {
    throw new OAuthError("invalid_grant", "redirect_uri does not match the authorization request");
  }
  if (!verifyPkce(input.codeVerifier, String(row.code_challenge))) {
    throw new OAuthError("invalid_grant", "PKCE verification failed");
  }
  const resource = String(row.resource);
  if (input.resource !== undefined && input.resource !== resource) {
    throw new OAuthError("invalid_target", "resource does not match the authorization request");
  }
  // Single use, race-safe: only one exchange can flip used_at.
  const claimed = await db.execute("UPDATE oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL", [
    sqlTime(),
    hashToken(input.code),
  ]);
  if (claimed !== 1) {
    await revokeGrant(grantId, "reuse");
    throw new OAuthError("invalid_grant", "Invalid authorization code");
  }
  await db.run("UPDATE oauth_clients SET last_used_at = ? WHERE id = ?", [sqlTime(), input.client.id]);
  return issueTokens(grantId, resource);
}

export async function refreshAccessToken(input: { client: OAuthClient; refreshToken: unknown; resource?: unknown }): Promise<TokenPair> {
  if (typeof input.refreshToken !== "string" || !input.refreshToken.startsWith(REFRESH_TOKEN_PREFIX)) {
    throw new OAuthError("invalid_grant", "Invalid refresh token");
  }
  const db = await getDb();
  const hash = hashToken(input.refreshToken);
  const rows = await db.query<Record<string, unknown>>(
    `SELECT t.*, g.client_id AS grant_client, g.revoked_at AS grant_revoked, ${liveSql("t.expires_at")}
     FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id
     WHERE t.token_hash = ? AND t.kind = 'refresh' LIMIT 1`,
    [sqlTime(), hash],
  );
  const row = rows[0];
  if (!row) throw new OAuthError("invalid_grant", "Invalid refresh token");
  const grantId = String(row.grant_id);
  if (String(row.grant_client) !== input.client.id) throw new OAuthError("invalid_grant", "Invalid refresh token");
  if (row.used_at != null) {
    await revokeGrant(grantId, "reuse");
    throw new OAuthError("invalid_grant", "Invalid refresh token");
  }
  if (row.revoked_at != null || row.grant_revoked != null || !isLive(row)) {
    throw new OAuthError("invalid_grant", "Invalid refresh token");
  }
  const resource = String(row.resource);
  if (input.resource !== undefined && input.resource !== resource) {
    throw new OAuthError("invalid_target", "resource does not match the grant");
  }
  const claimed = await db.execute("UPDATE oauth_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL", [sqlTime(), hash]);
  if (claimed !== 1) {
    await revokeGrant(grantId, "reuse");
    throw new OAuthError("invalid_grant", "Invalid refresh token");
  }
  return issueTokens(grantId, resource);
}

/** RFC 7009. Unknown tokens are not an error. Revoking a refresh token ends the grant. */
export async function revokeToken(client: OAuthClient, value: unknown): Promise<void> {
  if (typeof value !== "string" || value.length > 200) return;
  const db = await getDb();
  const rows = await db.query<Record<string, unknown>>(
    `SELECT t.kind, t.grant_id, g.client_id AS grant_client FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.token_hash = ? LIMIT 1`,
    [hashToken(value)],
  );
  const row = rows[0];
  if (!row || String(row.grant_client) !== client.id) return;
  if (row.kind === "refresh") {
    await revokeGrant(String(row.grant_id));
    return;
  }
  await db.run("UPDATE oauth_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE token_hash = ?", [sqlTime(), hashToken(value)]);
}

export interface VerifiedAccessToken {
  grant: OAuthGrant;
  role: string;
}

/**
 * Resolve a presented access token for `resource`. Null for anything unusable
 * — unknown, expired, revoked, bound to another resource, or whose grant or
 * user is gone — so callers answer with one generic 401.
 */
export async function verifyAccessToken(value: string, resource: string): Promise<VerifiedAccessToken | null> {
  if (typeof value !== "string" || !value.startsWith(ACCESS_TOKEN_PREFIX) || value.length > 200) return null;
  const db = await getDb();
  const rows = await db.query<Record<string, unknown>>(
    `SELECT grant_id, resource, revoked_at, ${liveSql("expires_at")} FROM oauth_tokens WHERE token_hash = ? AND kind = 'access' LIMIT 1`,
    [sqlTime(), hashToken(value)],
  );
  const row = rows[0];
  if (!row || row.revoked_at != null || !isLive(row) || String(row.resource) !== resource) return null;
  const grant = await getGrant(String(row.grant_id));
  if (!grant || grant.revokedAt) return null;
  const users = await db.query<{ role: string }>("SELECT role FROM users WHERE id = ? AND site_id = ? LIMIT 1", [
    grant.userId,
    grant.siteId,
  ]);
  const role = users[0]?.role;
  if (!role) return null;
  await db.run("UPDATE oauth_grants SET last_used_at = ? WHERE id = ?", [sqlTime(), grant.id]).catch(() => undefined);
  return { grant, role };
}

/** Housekeeping: drop expired codes and tokens. Safe to call at any time. */
export async function pruneExpiredOAuthRows(): Promise<void> {
  const db = await getDb();
  const cutoff = sqlTime(new Date(Date.now() - 24 * 60 * 60 * 1000));
  await db.run("DELETE FROM oauth_codes WHERE expires_at < ?", [cutoff]).catch(() => undefined);
  await db.run("DELETE FROM oauth_tokens WHERE expires_at < ?", [cutoff]).catch(() => undefined);
}
