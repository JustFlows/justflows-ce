// SPDX-License-Identifier: MIT

import express from "express";
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";
process.env.STATE = "INSTALLED";

/**
 * Passkeys driven through the real routes (#105): registration, passwordless
 * sign-in, passkey as a second factor, the per-role policy, and revocation.
 * The database is an in-memory stand-in that understands only the statements
 * these routes issue; the WebAuthn responses come from a software
 * authenticator with real keys and signatures.
 */

interface UserRow {
  id: string;
  site_id: string;
  email: string;
  display_name: string;
  password_hash: string;
  role: string;
  token_version: number;
  totp_secret: string | null;
  totp_confirmed_at: string | null;
  totp_recovery_codes: string | null;
  totp_last_step: number | null;
}
interface CredentialRow {
  id: string; user_id: string; site_id: string; credential_hash: string; credential_id: string; public_key: string;
  algorithm: number; sign_count: number; transports: string | null; aaguid: string; attestation_format: string;
  backup_eligible: boolean; backup_state: boolean; name: string; created_at: string; last_used_at: string | null;
}
interface ChallengeRow { id: string; site_id: string; user_id: string | null; purpose: string; challenge: string; rp_id: string; origin: string; expires_at: string }

let user: UserRow;
let sessions: Array<{ id: string; user_id: string; site_id: string; expires_at: string; revoked_at: string | null }>;
let credentials: CredentialRow[];
let challenges: ChallengeRow[];
let passkeyPolicy: Record<string, unknown> | null;

const fakeDb = {
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const rows = (value: unknown[]) => value as T[];
    if (/FROM webauthn_challenges WHERE id = \?/i.test(sql)) return rows(challenges.filter((c) => c.id === params[0]).map((c) => ({ ...c })));
    if (/COUNT\(\*\) AS total FROM webauthn_credentials/i.test(sql)) {
      return rows([{ total: credentials.filter((c) => c.user_id === params[0] && c.site_id === params[1]).length }]);
    }
    if (/FROM webauthn_credentials WHERE credential_hash = \?/i.test(sql)) return rows(credentials.filter((c) => c.credential_hash === params[0]).map((c) => ({ ...c })));
    if (/FROM webauthn_credentials WHERE user_id = \? AND site_id = \?/i.test(sql)) {
      return rows(credentials.filter((c) => c.user_id === params[0] && c.site_id === params[1]).map((c) => ({ ...c })));
    }
    if (/FROM site_settings/i.test(sql)) {
      return params.includes("security.passkeys") && passkeyPolicy ? rows([{ value: JSON.stringify(passkeyPolicy) }]) : [];
    }
    if (/FROM user_sessions/i.test(sql)) {
      const [id, userId, siteId, now] = params as string[];
      return rows(sessions.filter((s) => s.id === id && s.user_id === userId && s.site_id === siteId && !s.revoked_at && (now === undefined || s.expires_at > now)));
    }
    if (/FROM users/i.test(sql)) {
      const match = /email = \?/.test(sql) ? params.includes(user.email) : user.id === params[0];
      return match ? rows([{ ...user }]) : [];
    }
    if (/FROM sites/i.test(sql)) return rows([{ id: user.site_id, name: "Test Site" }]);
    return [];
  },
  async execute(sql: string, params: unknown[] = []): Promise<number> {
    if (/^DELETE FROM webauthn_challenges WHERE id = \?/i.test(sql)) {
      const before = challenges.length;
      challenges = challenges.filter((c) => c.id !== params[0]);
      return before - challenges.length;
    }
    if (/^UPDATE webauthn_credentials SET sign_count/i.test(sql)) {
      const [count, backup, used, id, previous] = params;
      const row = credentials.find((c) => c.id === id && c.sign_count === previous);
      if (!row) return 0;
      Object.assign(row, { sign_count: count, backup_state: backup, last_used_at: used });
      return 1;
    }
    if (/^UPDATE webauthn_credentials SET name/i.test(sql)) {
      const row = credentials.find((c) => c.id === params[1] && c.user_id === params[2] && c.site_id === params[3]);
      if (!row) return 0;
      row.name = String(params[0]);
      return 1;
    }
    if (/^DELETE FROM webauthn_credentials WHERE id = \?/i.test(sql)) {
      const before = credentials.length;
      credentials = credentials.filter((c) => !(c.id === params[0] && c.user_id === params[1] && c.site_id === params[2]));
      return before - credentials.length;
    }
    if (/^DELETE FROM webauthn_credentials WHERE user_id = \?/i.test(sql)) {
      const before = credentials.length;
      credentials = credentials.filter((c) => !(c.user_id === params[0] && c.site_id === params[1]));
      return before - credentials.length;
    }
    if (/SET totp_recovery_codes = NULL/i.test(sql) && /NOT EXISTS/i.test(sql)) {
      if (user.totp_confirmed_at || credentials.some((c) => c.user_id === user.id)) return 0;
      user.totp_recovery_codes = null;
      return 1;
    }
    if (/^UPDATE users SET totp_recovery_codes = \? WHERE id = \? AND site_id = \?$/i.test(sql.trim())) {
      user.totp_recovery_codes = String(params[0]);
      return 1;
    }
    if (/SET totp_recovery_codes = \?/i.test(sql)) {
      const [next, , , previous] = params;
      if (user.totp_recovery_codes !== previous) return 0;
      user.totp_recovery_codes = String(next);
      return 1;
    }
    if (/UPDATE user_sessions SET revoked_at = \? WHERE user_id = \? AND site_id = \? AND id <> \?/i.test(sql)) {
      const [at, userId, siteId, current] = params as string[];
      let count = 0;
      for (const s of sessions) if (s.user_id === userId && s.site_id === siteId && s.id !== current && !s.revoked_at) { s.revoked_at = at!; count++; }
      return count;
    }
    if (/UPDATE user_sessions SET revoked_at/i.test(sql)) {
      const [at, id, userId, siteId] = params as string[];
      const s = sessions.find((row) => row.id === id && row.user_id === userId && row.site_id === siteId && !row.revoked_at);
      if (!s) return 0;
      s.revoked_at = at!;
      return 1;
    }
    return 0;
  },
  async run(sql: string, params: unknown[] = []): Promise<void> {
    if (/^INSERT INTO webauthn_challenges/i.test(sql)) {
      const [id, site_id, user_id, purpose, challenge, rp_id, origin, expires_at] = params as string[];
      challenges.push({ id: id!, site_id: site_id!, user_id: user_id ?? null, purpose: purpose!, challenge: challenge!, rp_id: rp_id!, origin: origin!, expires_at: expires_at! });
      return;
    }
    if (/^DELETE FROM webauthn_challenges WHERE expires_at/i.test(sql)) return;
    if (/^INSERT INTO webauthn_credentials/i.test(sql)) {
      const columns = ["id", "user_id", "site_id", "credential_hash", "credential_id", "public_key", "algorithm", "sign_count",
        "transports", "aaguid", "attestation_format", "backup_eligible", "backup_state", "name", "created_at", "last_used_at"];
      credentials.push(Object.fromEntries(columns.map((column, i) => [column, params[i]])) as unknown as CredentialRow);
      return;
    }
    if (/^INSERT INTO user_sessions/i.test(sql)) {
      const [id, userId, siteId, , , , , expiresAt] = params as string[];
      sessions.push({ id: id!, user_id: userId!, site_id: siteId!, expires_at: expiresAt!, revoked_at: null });
    }
  },
  async close(): Promise<void> {},
};

vi.mock("../../../../src/lib/database/db.js", () => ({
  getDb: async () => fakeDb,
  getControlDb: async () => fakeDb,
  resetDb: () => {},
}));
const mail = vi.hoisted(() => ({ sent: [] as Array<{ key?: string; values?: Record<string, string> }> }));
vi.mock("../../../../src/lib/email/mail.js", () => ({
  sendMail: async () => ({ ok: true }),
  sendTemplateMail: async (message: { key?: string; values?: Record<string, string> }) => { mail.sent.push(message); return { ok: true }; },
  notifyAdmin: async () => ({ ok: true }),
}));
vi.mock("../../../../src/lib/settings/site-visibility.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/lib/settings/site-visibility.js")>()),
  isSiteClosed: async () => false,
}));
vi.mock("../../../../src/lib/plugins/plugin-runtime.js", () => ({
  getRuntimeHooks: () => ({ dispatchAction: async () => {}, has: () => false }),
  ensurePluginRuntime: async () => {},
  getPluginLoader: () => null,
}));

const { default: authRoutes } = await import("../../../../src/routes/auth/auth.js");
const { csrfProtection } = await import("../../../../src/middleware/csrf.js");
const { hashPassword } = await import("../../../../src/lib/auth/password.js");
const { resetRateLimits } = await import("../../../../src/lib/security/rate-limit.js");
const { encodeCbor } = await import("../../../../src/lib/auth/webauthn/cbor.js");
const { userHandleFor } = await import("../../../../src/lib/auth/webauthn/webauthn.js");
type CborValue = Parameters<typeof encodeCbor>[0];

let server: Server;
let base: string;
let rpId: string;

class Jar {
  private jar = new Map<string, string>();
  absorb(res: Response): void {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const eq = pair!.indexOf("=");
      this.jar.set(pair!.slice(0, eq), pair!.slice(eq + 1));
    }
  }
  header(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  get(name: string): string | undefined {
    return this.jar.get(name);
  }
}

async function send(method: string, path: string, jar: Jar, body?: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const cookie = jar.header();
  if (cookie) headers.cookie = cookie;
  const csrf = jar.get("jf_csrf");
  if (csrf) headers["x-csrf-token"] = decodeURIComponent(csrf);
  const res = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  jar.absorb(res);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}
const post = (path: string, jar: Jar, body: unknown = {}) => send("POST", path, jar, body);
const get = (path: string, jar: Jar) => send("GET", path, jar);

// ── Software authenticator ───────────────────────────────────────────────────

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest();

function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const cose = encodeCbor(new Map<CborValue, CborValue>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]));
  const credentialId = randomBytes(16);
  let counter = 0;
  const data = (flags: number, attested: boolean) => {
    const head = Buffer.alloc(37);
    sha256(Buffer.from(rpId)).copy(head, 0);
    head[32] = flags;
    head.writeUInt32BE(attested ? 0 : ++counter, 33);
    if (!attested) return head;
    const length = Buffer.alloc(2);
    length.writeUInt16BE(credentialId.length);
    return Buffer.concat([head, Buffer.alloc(16), length, credentialId, Buffer.from(cose)]);
  };
  const client = (type: string, challenge: string) => Buffer.from(JSON.stringify({ type, challenge, origin: base }));
  return {
    id: b64(credentialId),
    create(options: Record<string, any>) {
      const attestationObject = encodeCbor(new Map<CborValue, CborValue>([["fmt", "none"], ["attStmt", new Map()], ["authData", data(0x45, true)]]));
      return { id: b64(credentialId), rawId: b64(credentialId), type: "public-key", response: { clientDataJSON: b64(client("webauthn.create", options.publicKey.challenge)), attestationObject: b64(attestationObject), transports: ["internal"] } };
    },
    get(options: Record<string, any>, flags = 0x05, signer: KeyObject = privateKey) {
      const auth = data(flags, false);
      const clientData = client("webauthn.get", options.publicKey.challenge);
      const signature = sign("sha256", Buffer.concat([auth, sha256(clientData)]), signer);
      return { id: b64(credentialId), rawId: b64(credentialId), type: "public-key", response: { clientDataJSON: b64(clientData), authenticatorData: b64(auth), signature: b64(signature), userHandle: userHandleFor(user.id) } };
    },
  };
}

// ── Harness ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => {
    req.cookies = Object.fromEntries((req.headers.cookie ?? "").split(";").map((part) => part.trim()).filter(Boolean)
      .map((part) => { const i = part.indexOf("="); return [part.slice(0, i), decodeURIComponent(part.slice(i + 1))]; }));
    next();
  });
  app.use(express.json());
  app.use("/api", csrfProtection);
  app.use("/api/auth", authRoutes);
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  rpId = "127.0.0.1";
});

afterAll(() => {
  server?.close();
});

beforeEach(async () => {
  resetRateLimits();
  user = {
    id: "11111111-1111-4111-8111-111111111111",
    site_id: "22222222-2222-4222-8222-222222222222",
    email: "admin@example.com",
    display_name: "Admin",
    password_hash: await hashPassword("correct-horse-battery"),
    role: "administrator",
    token_version: 0,
    totp_secret: null,
    totp_confirmed_at: null,
    totp_recovery_codes: null,
    totp_last_step: null,
  };
  sessions = [];
  credentials = [];
  challenges = [];
  passkeyPolicy = null;
  mail.sent = [];
});

async function signIn(jar: Jar, extra: Record<string, unknown> = {}) {
  await get("/api/auth/csrf", jar);
  return post("/api/auth/login", jar, { email: user.email, password: "correct-horse-battery", adminPath: "/admin", ...extra });
}

async function register(jar: Jar, device = authenticator()) {
  const options = await post("/api/auth/passkeys/register/options", jar, { password: "correct-horse-battery" });
  expect(options.status).toBe(200);
  const verified = await post("/api/auth/passkeys/register/verify", jar, { ceremonyId: options.body.ceremonyId, credential: device.create(options.body), name: "Laptop" });
  return { device, options, verified };
}

describe("registering a passkey", () => {
  it("costs the password, binds the challenge to this site, and creates recovery codes once", async () => {
    const jar = new Jar();
    expect((await signIn(jar)).status).toBe(200);

    expect((await post("/api/auth/passkeys/register/options", jar, { password: "wrong" })).status).toBe(403);

    const { options, verified } = await register(jar);
    expect(options.body.publicKey.rp).toEqual({ id: "127.0.0.1", name: "Test Site" });
    expect(options.body.publicKey.user.id).toBe(userHandleFor(user.id));
    expect(verified.status).toBe(201);
    expect(verified.body.recoveryCodes).toHaveLength(10);
    expect(credentials).toHaveLength(1);
    expect(credentials[0]!.name).toBe("Laptop");
    expect(mail.sent.some((m) => m.key === "core.security-alert")).toBe(true);

    const listed = await get("/api/auth/passkeys", jar);
    expect(listed.body.passkeys).toHaveLength(1);
    expect(listed.body.recoveryCodesRemaining).toBe(10);
    expect(JSON.stringify(listed.body)).not.toContain(credentials[0]!.public_key);

    /** A second passkey keeps the codes the first one created. */
    const second = await register(jar);
    expect(second.verified.status).toBe(201);
    expect(second.verified.body.recoveryCodes).toBeUndefined();
  });

  it("accepts each challenge once", async () => {
    const jar = new Jar();
    await signIn(jar);
    const device = authenticator();
    const options = await post("/api/auth/passkeys/register/options", jar, { password: "correct-horse-battery" });
    const credential = device.create(options.body);
    expect((await post("/api/auth/passkeys/register/verify", jar, { ceremonyId: options.body.ceremonyId, credential })).status).toBe(201);
    expect((await post("/api/auth/passkeys/register/verify", jar, { ceremonyId: options.body.ceremonyId, credential })).status).toBe(400);
  });

  it("is refused when the role may not use passkeys", async () => {
    passkeyPolicy = { roles: { administrator: "disallow" } };
    const jar = new Jar();
    await signIn(jar);
    expect((await post("/api/auth/passkeys/register/options", jar, { password: "correct-horse-battery" })).status).toBe(403);
  });
});

describe("passwordless sign-in", () => {
  it("signs a staff account in on the admin surface only, once per challenge", async () => {
    const setup = new Jar();
    await signIn(setup);
    const { device } = await register(setup);

    const jar = new Jar();
    await get("/api/auth/csrf", jar);
    const options = await post("/api/auth/passkeys/login/options", jar, {});
    expect(options.body.publicKey.allowCredentials).toEqual([]);
    expect(options.body.publicKey.userVerification).toBe("required");
    const answer = device.get(options.body);

    /** Outside the admin path a staff passkey gets the same answer as an unknown one. */
    const hidden = await post("/api/auth/passkeys/login/verify", jar, { ceremonyId: options.body.ceremonyId, credential: answer });
    expect(hidden.status).toBe(401);

    const again = await post("/api/auth/passkeys/login/options", jar, {});
    const ok = await post("/api/auth/passkeys/login/verify", jar, { ceremonyId: again.body.ceremonyId, credential: device.get(again.body), adminPath: "/admin" });
    expect(ok.status).toBe(200);
    expect(ok.body.redirectTo).toBe("/admin");
    expect(jar.get("jf_session")).toBeTruthy();
    expect(credentials[0]!.last_used_at).toBeTruthy();

    const other = new Jar();
    await get("/api/auth/csrf", other);
    const replay = await post("/api/auth/passkeys/login/verify", other, { ceremonyId: again.body.ceremonyId, credential: device.get(again.body), adminPath: "/admin" });
    expect(replay.status).toBe(401);
  });

  it("requires user verification and a valid signature", async () => {
    const setup = new Jar();
    await signIn(setup);
    const { device } = await register(setup);
    const jar = new Jar();
    await get("/api/auth/csrf", jar);

    const noUv = await post("/api/auth/passkeys/login/options", jar, {});
    expect((await post("/api/auth/passkeys/login/verify", jar, { ceremonyId: noUv.body.ceremonyId, credential: device.get(noUv.body, 0x01), adminPath: "/admin" })).status).toBe(401);

    const forged = await post("/api/auth/passkeys/login/options", jar, {});
    const stranger = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
    expect((await post("/api/auth/passkeys/login/verify", jar, { ceremonyId: forged.body.ceremonyId, credential: device.get(forged.body, 0x05, stranger), adminPath: "/admin" })).status).toBe(401);
    expect(jar.get("jf_session")).toBeFalsy();
  });

  it("is refused when the role's policy disallows passkeys", async () => {
    const setup = new Jar();
    await signIn(setup);
    const { device } = await register(setup);
    passkeyPolicy = { roles: { administrator: "disallow" } };
    const jar = new Jar();
    await get("/api/auth/csrf", jar);
    const options = await post("/api/auth/passkeys/login/options", jar, {});
    expect((await post("/api/auth/passkeys/login/verify", jar, { ceremonyId: options.body.ceremonyId, credential: device.get(options.body), adminPath: "/admin" })).status).toBe(401);
  });
});

describe("passkey as a second factor", () => {
  it("is asked for after the password once the account has a passkey", async () => {
    const setup = new Jar();
    await signIn(setup);
    const { device, verified } = await register(setup);

    const jar = new Jar();
    const first = await signIn(jar);
    expect(first.status).toBe(401);
    expect(first.body.passkeyRequired).toBe(true);
    expect(first.body.passkeyOptions.publicKey.allowCredentials).toEqual([{ type: "public-key", id: device.id, transports: ["internal"] }]);
    expect(jar.get("jf_session")).toBeFalsy();

    const second = await signIn(jar, { passkey: { ceremonyId: first.body.passkeyOptions.ceremonyId, credential: device.get(first.body.passkeyOptions) } });
    expect(second.status).toBe(200);
    expect(jar.get("jf_session")).toBeTruthy();

    /** A recovery code stands in for a lost passkey. */
    const recovered = await signIn(new Jar(), { totp: verified.body.recoveryCodes[0] });
    expect(recovered.status).toBe(200);
  });

  it("will not accept a challenge issued to another account", async () => {
    const setup = new Jar();
    await signIn(setup);
    const { device } = await register(setup);
    const jar = new Jar();
    await get("/api/auth/csrf", jar);
    const passwordless = await post("/api/auth/passkeys/login/options", jar, {});
    const res = await signIn(jar, { passkey: { ceremonyId: passwordless.body.ceremonyId, credential: device.get(passwordless.body) } });
    expect(res.status).toBe(401);
    expect(jar.get("jf_session")).toBeFalsy();
  });
});

describe("per-role policy", () => {
  it("sends an account that must enrol to do so after signing in", async () => {
    passkeyPolicy = { roles: { administrator: "require" } };
    const jar = new Jar();
    const res = await signIn(jar);
    expect(res.status).toBe(200);
    expect(res.body.passkeyEnrollmentRequired).toBe(true);
    expect(res.body.redirectTo).toBe("/admin/security/account?enrol=passkey");
  });

  it("stops accepting an authenticator code once a required passkey exists, but keeps recovery codes", async () => {
    const setup = new Jar();
    await signIn(setup);
    const { verified } = await register(setup);
    passkeyPolicy = { roles: { administrator: "require" } };
    const challenge = await signIn(new Jar());
    expect(challenge.status).toBe(401);
    expect(challenge.body.totpAccepted).toBe(false);
    expect(challenge.body.passkeyRequired).toBe(true);
    expect((await signIn(new Jar(), { totp: verified.body.recoveryCodes[1] })).status).toBe(200);
  });

  it("ignores passkeys as a factor when the role disallows them", async () => {
    const setup = new Jar();
    await signIn(setup);
    await register(setup);
    passkeyPolicy = { roles: { administrator: "disallow" } };
    const res = await signIn(new Jar());
    expect(res.status).toBe(200);
  });
});

describe("revoking a passkey", () => {
  it("costs the password, ends other sessions, and drops recovery codes with the last factor", async () => {
    const setup = new Jar();
    await signIn(setup);
    const { device } = await register(setup);

    const jar = new Jar();
    const first = await signIn(jar);
    await signIn(jar, { passkey: { ceremonyId: first.body.passkeyOptions.ceremonyId, credential: device.get(first.body.passkeyOptions) } });
    const id = credentials[0]!.id;

    expect((await post(`/api/auth/passkeys/${id}/revoke`, jar, { password: "wrong" })).status).toBe(403);
    const revoked = await post(`/api/auth/passkeys/${id}/revoke`, jar, { password: "correct-horse-battery" });
    expect(revoked.status).toBe(200);
    expect(revoked.body.signedOut).toBe(1);
    expect(credentials).toHaveLength(0);
    expect(user.totp_recovery_codes).toBeNull();
    expect((await get("/api/auth/passkeys", setup)).status).toBe(401);
  });

  it("keeps the last passkey of a role that requires one", async () => {
    const jar = new Jar();
    await signIn(jar);
    await register(jar);
    passkeyPolicy = { roles: { administrator: "require" } };
    const res = await post(`/api/auth/passkeys/${credentials[0]!.id}/revoke`, jar, { password: "correct-horse-battery" });
    expect(res.status).toBe(409);
    expect(credentials).toHaveLength(1);
  });

  it("renames only the account's own passkeys", async () => {
    const jar = new Jar();
    await signIn(jar);
    await register(jar);
    expect((await send("PATCH", `/api/auth/passkeys/${credentials[0]!.id}`, jar, { name: "Phone" })).status).toBe(200);
    expect(credentials[0]!.name).toBe("Phone");
    expect((await send("PATCH", "/api/auth/passkeys/33333333-3333-4333-8333-333333333333", jar, { name: "x" })).status).toBe(404);
  });
});
