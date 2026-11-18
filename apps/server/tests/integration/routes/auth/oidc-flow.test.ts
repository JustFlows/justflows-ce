// SPDX-License-Identifier: MIT

import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import cookieParser from "cookie-parser";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A full OpenID Connect sign-in (justflows-ce#54) through the real routes and
 * openid-client, against a small provider that checks PKCE and signs ID tokens.
 * Only existing accounts are signed in; state, nonce, verified email, allowed
 * domains, linking by subject, and the second-factor step-up are covered.
 */
process.env.APP_SECRET ||= "oidc-test-secret-of-at-least-thirty-two-chars";
process.env.JF_OIDC_ALLOW_HTTP = "1";

const state = vi.hoisted(() => ({
  identities: [] as Array<{ site_id: string; user_id: string; provider_id: string; subject: string; email: string | null }>,
  signIns: [] as Array<{ userId: string; method: string }>,
  audits: [] as string[],
  factors: { totp: false, passkeys: 0 },
  idp: { sub: "subject-1", email: "ada@corp.example", email_verified: true as boolean, amr: [] as string[], nonceOverride: null as string | null },
  base: "",
}));

const accounts: Record<string, { id: string; siteId: string; homeSiteId: string; email: string; role: string; token_version: number }> = {
  "ada@corp.example": { id: "user-ada", siteId: "site-1", homeSiteId: "site-1", email: "ada@corp.example", role: "administrator", token_version: 0 },
};

vi.mock("../../../../src/lib/settings/site-settings.js", () => ({
  getSiteId: async () => "site-1",
  getSiteSetting: async () => ({ providers: (globalThis as unknown as { __providers: unknown[] }).__providers }),
  setSiteSetting: async () => undefined,
}));
vi.mock("../../../../src/lib/admin/admin-path.js", () => ({ getAdminPathConfig: async () => ({ path: "/admin" }) }));
vi.mock("../../../../src/lib/auth/auth-surface.js", () => ({
  knowsAdminPath: (supplied: unknown, configured: string) => supplied === configured,
  postAuthRedirect: async () => "/admin",
}));
vi.mock("../../../../src/lib/ai/ai-settings.js", () => ({ publicOrigin: () => state.base }));
vi.mock("../../../../src/lib/auth/sign-in.js", () => ({
  finishSignIn: async (_req: unknown, res: express.Response, account: { id: string }, method: string) => {
    state.signIns.push({ userId: account.id, method });
    res.cookie("jf_session", "signed-in");
    return true;
  },
}));
vi.mock("../../../../src/lib/security/audit-log.js", () => ({
  auditContext: () => ({}),
  auditLog: (entry: { action: string; detail?: string }) => state.audits.push(`${entry.action}:${entry.detail ?? ""}`),
  auditFromRequest: (_req: unknown, action: string) => state.audits.push(action),
}));
vi.mock("../../../../src/lib/tenancy/access.js", () => ({
  findLoginAccount: async (_siteId: string, email: string) => accounts[email] ?? null,
}));
vi.mock("../../../../src/lib/auth/mfa-policy.js", () => ({ secondFactorsOf: async () => state.factors }));
vi.mock("../../../../src/lib/database/db.js", () => ({
  getDb: async () => ({
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes("FROM user_identities ui JOIN users")) {
        return state.identities
          .filter((row) => row.provider_id === params[0] && row.subject === params[1])
          .map((row) => ({ user_id: row.user_id, site_id: row.site_id, email: Object.values(accounts).find((a) => a.id === row.user_id)!.email }));
      }
      if (sql.startsWith("SELECT id FROM user_identities WHERE site_id = ? AND user_id = ? AND provider_id = ?")) {
        return state.identities.filter((row) => row.site_id === params[0] && row.user_id === params[1] && row.provider_id === params[2]).map((row) => ({ id: row.subject }));
      }
      if (sql.startsWith("SELECT user_id FROM user_identities")) {
        return state.identities.filter((row) => row.site_id === params[0] && row.provider_id === params[1] && row.subject === params[2]).map((row) => ({ user_id: row.user_id }));
      }
      return [];
    },
    run: async (sql: string, params: unknown[]) => {
      if (sql.startsWith("INSERT INTO user_identities")) {
        state.identities.push({ site_id: String(params[1]), user_id: String(params[2]), provider_id: String(params[3]), subject: String(params[4]), email: params[5] as string | null });
      }
    },
    execute: async () => 0,
  }),
}));

const { encryptSecret } = await import("../../../../src/lib/security/secret-box.js");
const { default: oidcRoutes } = await import("../../../../src/routes/auth/oidc.js");

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function idToken(claims: Record<string, unknown>): string {
  const head = b64({ alg: "RS256", kid: "k1", typ: "JWT" });
  const body = b64(claims);
  const signature = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey).toString("base64url");
  return `${head}.${body}.${signature}`;
}

let idp: Server;
let app: Server;
let issuer = "";
const codes = new Map<string, { challenge: string; nonce: string; redirect: string }>();

beforeAll(async () => {
  const provider = express();
  provider.use(express.urlencoded({ extended: false }));
  provider.get("/.well-known/openid-configuration", (_req, res) =>
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_post"],
    }),
  );
  provider.get("/jwks", (_req, res) => res.json({ keys: [jwk] }));
  provider.get("/authorize", (req, res) => {
    const code = randomBytes(12).toString("hex");
    codes.set(code, { challenge: String(req.query.code_challenge), nonce: String(req.query.nonce), redirect: String(req.query.redirect_uri) });
    expect(req.query.code_challenge_method).toBe("S256");
    res.redirect(`${String(req.query.redirect_uri)}?code=${code}&state=${String(req.query.state)}`);
  });
  provider.post("/token", (req, res) => {
    const grant = codes.get(String(req.body.code));
    const verifier = String(req.body.code_verifier ?? "");
    if (!grant || createHash("sha256").update(verifier).digest("base64url") !== grant.challenge || req.body.client_secret !== "shh") {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }
    codes.delete(String(req.body.code));
    const now = Math.floor(Date.now() / 1000);
    res.json({
      access_token: "at",
      token_type: "Bearer",
      id_token: idToken({
        iss: issuer,
        aud: "justflows",
        sub: state.idp.sub,
        email: state.idp.email,
        email_verified: state.idp.email_verified,
        nonce: state.idp.nonceOverride ?? grant.nonce,
        iat: now,
        exp: now + 300,
        ...(state.idp.amr.length ? { amr: state.idp.amr } : {}),
      }),
    });
  });
  idp = provider.listen(0);
  await new Promise((resolve) => idp.once("listening", resolve));
  issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;

  const site = express();
  site.use(express.json());
  site.use(cookieParser());
  site.use("/api/auth/oidc", oidcRoutes);
  app = site.listen(0);
  await new Promise((resolve) => app.once("listening", resolve));
  state.base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => idp.close(() => resolve(null)));
  await new Promise((resolve) => app.close(() => resolve(null)));
});

beforeEach(() => {
  state.identities = [];
  state.signIns = [];
  state.audits = [];
  state.factors = { totp: false, passkeys: 0 };
  state.idp = { sub: "subject-1", email: "ada@corp.example", email_verified: true, amr: [], nonceOverride: null };
  (globalThis as unknown as { __providers: unknown[] }).__providers = [
    {
      id: "corp",
      name: "Corp SSO",
      enabled: true,
      issuer,
      clientId: "justflows",
      clientSecretCipher: encryptSecret("shh"),
      scopes: ["openid", "email"],
      allowedDomains: ["corp.example"],
      mfaAmr: ["mfa"],
      mfaAcr: [],
    },
  ];
});

/** Start, follow the provider's redirect, and call back with the flow cookie, like a browser. */
async function signIn(tamper?: (callback: URL) => void) {
  const start = await fetch(`${state.base}/api/auth/oidc/corp/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adminPath: "/admin" }) });
  expect(start.status).toBe(200);
  const cookie = start.headers.get("set-cookie")!.split(";")[0]!;
  const { url } = (await start.json()) as { url: string };
  const authorize = await fetch(url, { redirect: "manual" });
  const callback = new URL(authorize.headers.get("location")!);
  tamper?.(callback);
  return fetch(callback, { redirect: "manual", headers: { cookie } });
}

describe("OpenID Connect sign-in", () => {
  it("lists providers and starts only from the staff sign-in page", async () => {
    expect(await (await fetch(`${state.base}/api/auth/oidc/providers`)).json()).toEqual({ providers: [{ id: "corp", name: "Corp SSO" }] });
    const blind = await fetch(`${state.base}/api/auth/oidc/corp/start`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(blind.status).toBe(404);
  });

  it("signs in an existing account with PKCE, links it by subject, and uses the link next time", async () => {
    const res = await signIn();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin");
    expect(state.signIns).toEqual([{ userId: "user-ada", method: "oidc:corp" }]);
    expect(state.identities).toEqual([expect.objectContaining({ user_id: "user-ada", provider_id: "corp", subject: "subject-1" })]);
    expect(state.audits.some((entry) => entry.startsWith("auth.identity_linked"))).toBe(true);
    /** The provider now reports another address: the stable subject still finds the account. */
    state.idp.email = "someone-else@corp.example";
    const again = await signIn();
    expect(again.headers.get("location")).toBe("/admin");
    expect(state.signIns).toHaveLength(2);
    expect(state.identities).toHaveLength(1);
  });

  it("refuses a changed state, a wrong nonce, an unverified email, another domain, and an unknown person", async () => {
    const refused = async (setup: () => void, tamper?: (callback: URL) => void) => {
      state.signIns = [];
      setup();
      const res = await signIn(tamper);
      expect(res.headers.get("location")).toBe("/admin/login?federated=error");
      expect(state.signIns).toEqual([]);
    };
    await refused(() => undefined, (callback) => callback.searchParams.set("state", "forged"));
    await refused(() => { state.idp.nonceOverride = "replayed"; });
    await refused(() => { state.idp.nonceOverride = null; state.idp.email_verified = false; });
    await refused(() => { state.idp.email_verified = true; state.idp.email = "ada@other.example"; });
    await refused(() => { state.idp.email = "nobody@corp.example"; });
    expect(state.identities).toEqual([]);
  });

  it("does not let a different subject with the same address join an already linked account", async () => {
    await signIn();
    expect(state.identities).toHaveLength(1);
    state.signIns = [];
    state.idp.sub = "subject-2";
    const res = await signIn();
    expect(res.headers.get("location")).toBe("/admin/login?federated=error");
    expect(state.signIns).toEqual([]);
    expect(state.identities).toHaveLength(1);
  });

  it("asks for the account's own second factor unless the provider proves MFA", async () => {
    state.factors = { totp: true, passkeys: 0 };
    const stepUp = await signIn();
    expect(stepUp.headers.get("location")).toBe("/admin/login?federated=1");
    expect(stepUp.headers.get("set-cookie")).toContain("jf_oidc_pending=");
    expect(state.signIns).toEqual([]);
    state.idp.amr = ["pwd", "mfa"];
    const proven = await signIn();
    expect(proven.headers.get("location")).toBe("/admin");
    expect(state.signIns).toEqual([{ userId: "user-ada", method: "oidc:corp" }]);
  });

  it("does not finish a step-up without a valid pending sign-in", async () => {
    const res = await fetch(`${state.base}/api/auth/oidc/complete`, { method: "POST", headers: { "content-type": "application/json", cookie: "jf_oidc_pending=forged.value" }, body: JSON.stringify({ totp: "123456" }) });
    expect(res.status).toBe(401);
    expect(state.signIns).toEqual([]);
  });
});
