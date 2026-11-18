// SPDX-License-Identifier: MIT

import { createHmac, hkdfSync, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getDb } from "../database/db.js";
import { getSiteSetting, setSiteSetting } from "../settings/site-settings.js";
import { decryptSecret, encryptSecret } from "../security/secret-box.js";

/**
 * Sign-in through an OpenID Connect provider (justflows-ce#54): Authorization
 * Code with PKCE (S256), and state and nonce checked on return. Providers only
 * sign people in to accounts that already exist: matched by the provider's
 * stable subject once linked, or the first time by a verified email in an
 * allowed domain. Nobody is created. Local password sign-in stays available.
 */

export const OIDC_SETTING_KEY = "security.oidc";
const MAX_PROVIDERS = 5;

/** amr values that mean the provider checked more than one factor. */
export const DEFAULT_MFA_AMR = ["mfa", "otp", "hwk", "swk", "sc"];

const ProviderInputSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  name: z.string().trim().min(1).max(60),
  enabled: z.boolean().default(true),
  issuer: z.string().url().max(512),
  clientId: z.string().min(1).max(512),
  /** Write-only. Blank keeps the stored secret. */
  clientSecret: z.string().max(4096).optional(),
  scopes: z.array(z.string().regex(/^[\x21\x23-\x5b\x5d-\x7e]{1,64}$/)).max(20).default(["openid", "email", "profile"]),
  allowedDomains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]{1,253}$/)).max(50).default([]),
  mfaAmr: z.array(z.string().max(64)).max(20).default(DEFAULT_MFA_AMR),
  mfaAcr: z.array(z.string().max(255)).max(20).default([]),
});

export interface OidcProvider {
  id: string;
  name: string;
  enabled: boolean;
  issuer: string;
  clientId: string;
  /** Encrypted with APP_SECRET. */
  clientSecretCipher: string;
  scopes: string[];
  allowedDomains: string[];
  mfaAmr: string[];
  mfaAcr: string[];
}

export interface OidcProviderView extends Omit<OidcProvider, "clientSecretCipher"> {
  clientSecretSet: boolean;
}

function asProviders(raw: unknown): OidcProvider[] {
  const list = (raw as { providers?: unknown } | null)?.providers;
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is OidcProvider => Boolean(item) && typeof (item as OidcProvider).id === "string");
}

export async function getOidcProviders(siteId: string): Promise<OidcProvider[]> {
  return asProviders(await getSiteSetting(siteId, OIDC_SETTING_KEY));
}

export function providerView(provider: OidcProvider): OidcProviderView {
  const { clientSecretCipher, ...rest } = provider;
  return { ...rest, clientSecretSet: Boolean(clientSecretCipher) };
}

/** Validate and store providers. An https issuer is required outside development. */
export async function saveOidcProviders(siteId: string, raw: unknown): Promise<OidcProvider[]> {
  const parsed = z.array(ProviderInputSchema).max(MAX_PROVIDERS).safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.issues[0] ? `${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message}` : "Invalid providers");
  const existing = new Map((await getOidcProviders(siteId)).map((provider) => [provider.id, provider]));
  const ids = new Set<string>();
  const providers = parsed.data.map((input): OidcProvider => {
    if (ids.has(input.id)) throw new Error(`Provider id "${input.id}" is used twice`);
    ids.add(input.id);
    const issuer = new URL(input.issuer);
    if (issuer.protocol !== "https:" && !allowInsecureIssuers()) throw new Error(`${input.name}: the issuer must use https`);
    if (!input.scopes.includes("openid")) input.scopes.unshift("openid");
    const secret = input.clientSecret?.trim();
    return {
      id: input.id,
      name: input.name,
      enabled: input.enabled,
      issuer: issuer.toString().replace(/\/$/, ""),
      clientId: input.clientId,
      clientSecretCipher: secret ? encryptSecret(secret) : (existing.get(input.id)?.clientSecretCipher ?? ""),
      scopes: [...new Set(input.scopes)],
      allowedDomains: [...new Set(input.allowedDomains.map((domain) => domain.toLowerCase()))],
      mfaAmr: input.mfaAmr,
      mfaAcr: input.mfaAcr,
    };
  });
  await setSiteSetting(siteId, OIDC_SETTING_KEY, { providers });
  configCache.clear();
  return providers;
}

/** Plain-http issuers are only for local development and tests. */
export function allowInsecureIssuers(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.JF_OIDC_ALLOW_HTTP === "1";
}

type ClientModule = typeof import("openid-client");
const configCache = new Map<string, { at: number; config: import("openid-client").Configuration }>();
const DISCOVERY_CACHE_MS = 10 * 60 * 1000;

async function clientConfig(client: ClientModule, provider: OidcProvider) {
  const key = `${provider.issuer}|${provider.clientId}`;
  const hit = configCache.get(key);
  if (hit && Date.now() - hit.at < DISCOVERY_CACHE_MS) return hit.config;
  const secret = decryptSecret(provider.clientSecretCipher);
  const config = await client.discovery(
    new URL(provider.issuer),
    provider.clientId,
    secret ? { client_secret: secret } : undefined,
    secret ? client.ClientSecretPost(secret) : client.None(),
    allowInsecureIssuers() ? { execute: [client.allowInsecureRequests] } : undefined,
  );
  configCache.set(key, { at: Date.now(), config });
  return config;
}

function stateKey(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) throw new Error("APP_SECRET must be at least 32 characters");
  return Buffer.from(hkdfSync("sha256", secret, "justflows-oidc", "flow-state", 32));
}

/** Seal a short-lived value into a signed cookie. Not secret, only tamper-proof. */
export function sealFlow(value: Record<string, unknown>): string {
  const data = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${data}.${createHmac("sha256", stateKey()).update(data).digest("base64url")}`;
}

export function openFlow<T extends { exp: number }>(token: string | undefined): T | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const data = token.slice(0, dot);
  const expected = Buffer.from(createHmac("sha256", stateKey()).update(data).digest("base64url"));
  const supplied = Buffer.from(token.slice(dot + 1));
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const value = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as T;
    return typeof value.exp === "number" && value.exp > Date.now() ? value : null;
  } catch {
    return null;
  }
}

export interface StartedFlow {
  url: string;
  state: { p: string; s: string; v: string; st: string; n: string; staff: boolean; exp: number };
}

/** Build the authorization request: PKCE S256, a random state, and a random nonce. */
export async function startFlow(provider: OidcProvider, siteId: string, redirectUri: string, staff: boolean): Promise<StartedFlow> {
  const client = await import("openid-client");
  const config = await clientConfig(client, provider);
  const verifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: provider.scopes.join(" "),
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
    nonce,
  });
  return { url: url.href, state: { p: provider.id, s: siteId, v: verifier, st: state, n: nonce, staff, exp: Date.now() + 10 * 60 * 1000 } };
}

export interface VerifiedIdentity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  /** The provider said the person used more than one factor. */
  mfa: boolean;
}

/** Exchange the code and validate the ID token (signature, issuer, audience, expiry, nonce). */
export async function finishFlow(provider: OidcProvider, callbackUrl: URL, flow: StartedFlow["state"]): Promise<VerifiedIdentity> {
  const client = await import("openid-client");
  const config = await clientConfig(client, provider);
  const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: flow.v,
    expectedState: flow.st,
    expectedNonce: flow.n,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims?.sub) throw new Error("The provider sent no subject");
  const amr = Array.isArray(claims.amr) ? claims.amr.map(String) : [];
  const acr = typeof claims.acr === "string" ? claims.acr : "";
  return {
    subject: String(claims.sub).slice(0, 255),
    email: typeof claims.email === "string" ? claims.email.toLowerCase().trim() : null,
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    mfa: amr.some((value) => provider.mfaAmr.includes(value)) || (acr !== "" && provider.mfaAcr.includes(acr)),
  };
}

export function emailDomainAllowed(provider: OidcProvider, email: string): boolean {
  if (provider.allowedDomains.length === 0) return true;
  const domain = email.split("@")[1] ?? "";
  return provider.allowedDomains.includes(domain);
}

export interface LinkedIdentity {
  id: string;
  providerId: string;
  email: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/** The account already linked to this provider subject on its home site. */
export async function findLinkedUser(homeSiteId: string, providerId: string, subject: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.query<{ user_id: string }>(
    "SELECT user_id FROM user_identities WHERE site_id = ? AND provider_id = ? AND subject = ? LIMIT 1",
    [homeSiteId, providerId, subject],
  );
  return rows[0] ? String(rows[0].user_id) : null;
}

/**
 * Whether the account is already linked to some identity at this provider.
 * Email may only link an account that has none: a different person who later
 * holds the same address at the provider must not be added to it.
 */
export async function hasProviderLink(homeSiteId: string, userId: string, providerId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query<{ id: string }>(
    "SELECT id FROM user_identities WHERE site_id = ? AND user_id = ? AND provider_id = ? LIMIT 1",
    [homeSiteId, userId, providerId],
  );
  return rows.length > 0;
}

export async function linkIdentity(input: { homeSiteId: string; userId: string; providerId: string; subject: string; email: string | null }): Promise<void> {
  const db = await getDb();
  await db.run(
    "INSERT INTO user_identities (id, site_id, user_id, provider_id, subject, email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [randomUUID(), input.homeSiteId, input.userId, input.providerId, input.subject, input.email, new Date().toISOString().replace("T", " ").replace(/Z$/, "")],
  );
}

export async function touchIdentity(homeSiteId: string, providerId: string, subject: string): Promise<void> {
  const db = await getDb();
  await db.run("UPDATE user_identities SET last_used_at = ? WHERE site_id = ? AND provider_id = ? AND subject = ?", [
    new Date().toISOString().replace("T", " ").replace(/Z$/, ""),
    homeSiteId,
    providerId,
    subject,
  ]);
}

export async function listLinkedIdentities(userId: string): Promise<LinkedIdentity[]> {
  const db = await getDb();
  const rows = await db.query<Record<string, unknown>>(
    "SELECT id, provider_id, email, created_at, last_used_at FROM user_identities WHERE user_id = ? ORDER BY created_at",
    [userId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    providerId: String(row.provider_id),
    email: row.email ? String(row.email) : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    lastUsedAt: row.last_used_at ? (row.last_used_at instanceof Date ? row.last_used_at.toISOString() : String(row.last_used_at)) : null,
  }));
}

export async function unlinkIdentity(userId: string, id: string): Promise<boolean> {
  const db = await getDb();
  return (await db.execute("DELETE FROM user_identities WHERE id = ? AND user_id = ?", [id, userId])) > 0;
}
