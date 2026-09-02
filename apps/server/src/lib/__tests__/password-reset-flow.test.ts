import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";
process.env.STATE = "INSTALLED";

/**
 * The emailed password-reset flow (#93), driven end to end through the real
 * routes. What matters here is the security shape: the request side never
 * reveals whether an address exists, a link works exactly once, an expired link
 * is refused, the account's sessions are all revoked, and no session is
 * established — so a second factor still stands between the reset and access.
 */

const SITE_ID = "22222222-2222-4222-8222-222222222222";

interface UserRow {
  id: string;
  site_id: string;
  email: string;
  display_name: string;
  role: string;
  password_hash: string;
  token_version: number;
}

interface ResetRow {
  id: string;
  user_id: string;
  site_id: string;
  token_hash: string;
  requested_ip: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

let users: UserRow[];
let resets: ResetRow[];
let sentMail: { to: string; subject: string; text: string }[];

let settings = {
  adminEmail: "admin@example.com",
  usersCanRegister: false,
  defaultRole: "subscriber" as const,
  passwordResetEnabled: true,
  passwordResetRoles: [] as string[],
  timezone: "UTC",
  dateFormat: "Y-m-d",
  timeFormat: "H:i",
  startOfWeek: 1,
};

function sqlTime(d: Date): string {
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

/** Minimal SQL interpreter covering only the statements these routes issue. */
const fakeDb = {
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (/FROM sites/i.test(sql)) {
      return [{ id: SITE_ID, name: "Test Site" }] as unknown as T[];
    }
    if (/FROM users/i.test(sql)) {
      if (/email = \?/.test(sql)) {
        const [siteId, email] = params as string[];
        return users.filter((u) => u.site_id === siteId && u.email === email) as unknown as T[];
      }
      if (/id = \?/.test(sql)) {
        const [id, siteId] = params as string[];
        return users.filter(
          (u) => u.id === id && (siteId === undefined || u.site_id === siteId),
        ) as unknown as T[];
      }
      return [] as T[];
    }
    if (/FROM password_resets/i.test(sql)) {
      const [tokenHash, notAfter] = params as string[];
      return resets
        .filter((r) => r.token_hash === tokenHash && !r.used_at && r.expires_at > notAfter)
        .map((r) => ({ id: r.id, user_id: r.user_id, site_id: r.site_id })) as unknown as T[];
    }
    return [] as T[];
  },
  async run(sql: string, params: unknown[] = []): Promise<void> {
    if (/^INSERT INTO password_resets/i.test(sql)) {
      const [id, user_id, site_id, token_hash, requested_ip, created_at, expires_at] =
        params as (string | null)[];
      resets.push({
        id: id!,
        user_id: user_id!,
        site_id: site_id!,
        token_hash: token_hash!,
        requested_ip: requested_ip ?? null,
        created_at: created_at!,
        expires_at: expires_at!,
        used_at: null,
      });
      return;
    }
    if (/^DELETE FROM password_resets/i.test(sql)) {
      if (/user_id = \?/i.test(sql)) {
        const [userId, siteId] = params as string[];
        resets = resets.filter((r) => !(r.user_id === userId && r.site_id === siteId));
      } else {
        const [cutoff] = params as string[];
        resets = resets.filter((r) => !(r.expires_at < cutoff || r.used_at));
      }
      return;
    }
    if (/UPDATE password_resets SET used_at/i.test(sql)) {
      const [usedAt, id] = params as string[];
      const row = resets.find((r) => r.id === id);
      if (row) row.used_at = usedAt;
      return;
    }
    if (/UPDATE users SET token_version/i.test(sql)) {
      const [id, siteId] = params as string[];
      const row = users.find((u) => u.id === id && u.site_id === siteId);
      if (row) row.token_version += 1;
      return;
    }
    if (/UPDATE users SET password_hash/i.test(sql)) {
      const [hash, , id, siteId] = params as string[];
      const row = users.find((u) => u.id === id && u.site_id === siteId);
      if (row) row.password_hash = hash;
      return;
    }
    // audit_log inserts and anything else: no-op.
  },
  async close(): Promise<void> {},
};

vi.mock("../db.js", () => ({ getDb: async () => fakeDb, resetDb: () => {} }));
vi.mock("../general-settings.js", () => ({
  getGeneralSettings: async () => settings,
}));
vi.mock("../mail.js", () => ({
  sendMail: async (msg: { to: string; subject: string; text: string }) => {
    sentMail.push(msg);
    return { ok: true };
  },
  sendTemplateMail: async (msg: { to: string; key: string; values: Record<string, string> }) => {
    sentMail.push({
      to: msg.to,
      subject: msg.key.includes("changed") ? "Your password was changed" : "Reset your password",
      text: Object.values(msg.values).join("\n"),
    });
    return { ok: true };
  },
  notifyAdmin: async () => ({ ok: true }),
}));
vi.mock("../plugin-runtime.js", () => ({
  getRuntimeHooks: () => ({ dispatchAction: async () => {}, has: () => false }),
  ensurePluginRuntime: async () => {},
  getPluginLoader: () => null,
}));

const { default: authRoutes } = await import("../../routes/auth.js");
const { csrfProtection } = await import("../../middleware/csrf.js");
const { hashPassword, verifyPassword } = await import("../password.js");
const { hashResetToken } = await import("../password-reset-db.js");
const { resetRateLimits } = await import("../rate-limit.js");

let server: Server;
let base: string;

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

async function get(path: string, jar: Jar) {
  const headers: Record<string, string> = {};
  const cookie = jar.header();
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${base}${path}`, { headers });
  jar.absorb(res);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}

async function post(path: string, body: unknown, jar: Jar) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const cookie = jar.header();
  if (cookie) headers.cookie = cookie;
  const csrf = jar.get("jf_csrf");
  if (csrf) headers["x-csrf-token"] = decodeURIComponent(csrf);
  const res = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  jar.absorb(res);
  return {
    status: res.status,
    setCookie: res.headers.getSetCookie?.() ?? [],
    body: (await res.json().catch(() => ({}))) as Record<string, any>,
  };
}

/** Let the fire-and-forget forgot-password work settle. */
const flush = () => new Promise((r) => setTimeout(r, 60));

async function requestReset(email: string, jar = new Jar()) {
  await get("/api/auth/csrf", jar);
  const res = await post("/api/auth/password/forgot", { email }, jar);
  await flush();
  return res;
}

/** Pull the token out of the most recent reset email. */
function tokenFromMail(): string {
  const mail = sentMail.at(-1)!;
  return /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
}

beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => {
    req.cookies = Object.fromEntries(
      (req.headers.cookie ?? "")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const separator = part.indexOf("=");
          return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
        }),
    );
    next();
  });
  app.use(express.json());
  app.use("/api", csrfProtection);
  app.use("/api/auth", authRoutes);
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
});

beforeEach(async () => {
  resetRateLimits();
  sentMail = [];
  resets = [];
  settings = {
    adminEmail: "admin@example.com",
    usersCanRegister: false,
    defaultRole: "subscriber",
    passwordResetEnabled: true,
    passwordResetRoles: [],
    timezone: "UTC",
    dateFormat: "Y-m-d",
    timeFormat: "H:i",
    startOfWeek: 1,
  };
  users = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      site_id: SITE_ID,
      email: "person@example.com",
      display_name: "Person",
      role: "administrator",
      password_hash: await hashPassword("the-old-password-1"),
      token_version: 0,
    },
  ];
});

describe("POST /api/auth/password/forgot — no enumeration", () => {
  it("answers identically for a known and an unknown address", async () => {
    const known = await requestReset("person@example.com");
    const unknown = await requestReset("nobody@example.com");
    expect(known.status).toBe(200);
    expect(known.body).toEqual({ ok: true });
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual({ ok: true });
  });

  it("only mails a link when the address is real", async () => {
    await requestReset("person@example.com");
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0]!.to).toBe("person@example.com");
    expect(sentMail[0]!.text).toContain("/reset-password?token=");

    sentMail = [];
    await requestReset("nobody@example.com");
    expect(sentMail).toHaveLength(0);
  });

  it("rejects a malformed address without touching the store", async () => {
    const jar = new Jar();
    await get("/api/auth/csrf", jar);
    const res = await post("/api/auth/password/forgot", { email: "not-an-email" }, jar);
    expect(res.status).toBe(400);
    expect(sentMail).toHaveLength(0);
  });

  it("stores only the hash of the token, never the token", async () => {
    await requestReset("person@example.com");
    const token = tokenFromMail();
    expect(resets).toHaveLength(1);
    expect(resets[0]!.token_hash).toBe(hashResetToken(token));
    expect(resets[0]!.token_hash).not.toContain(token);
  });

  it("prints the link to the console only when NODE_ENV is development", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const original = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "test";
      await requestReset("person@example.com");
      expect(spy.mock.calls.flat().join(" ")).not.toContain("/reset-password?token=");

      spy.mockClear();
      process.env.NODE_ENV = "development";
      await requestReset("person@example.com");
      expect(spy.mock.calls.flat().join(" ")).toContain("/reset-password?token=");
    } finally {
      process.env.NODE_ENV = original;
      spy.mockRestore();
    }
  });
});

describe("POST /api/auth/password/forgot — rate limiting", () => {
  it("stops a burst from one IP with 429", async () => {
    const jar = new Jar();
    await get("/api/auth/csrf", jar);
    const codes: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const res = await post(
        "/api/auth/password/forgot",
        { email: `user${i}@example.com` },
        jar,
      );
      codes.push(res.status);
    }
    expect(codes.filter((c) => c === 200).length).toBe(5);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
  });

  it("stops repeated requests for one address with 429", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      // A fresh jar each time keeps the per-IP counter low; the per-address
      // counter is the one under test.
      const jar = new Jar();
      await get("/api/auth/csrf", jar);
      const res = await post(
        "/api/auth/password/forgot",
        { email: "person@example.com" },
        jar,
      );
      codes.push(res.status);
    }
    expect(codes.slice(0, 3)).toEqual([200, 200, 200]);
    expect(codes.slice(3)).toContain(429);
  });
});

describe("POST /api/auth/password/reset — redeeming a link", () => {
  it("sets the new password, revokes sessions, and does not sign the user in", async () => {
    await requestReset("person@example.com");
    const token = tokenFromMail();

    const jar = new Jar();
    await get("/api/auth/csrf", jar);
    const res = await post(
      "/api/auth/password/reset",
      { token, newPassword: "a-brand-new-password-9" },
      jar,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // No session cookie — a second factor still applies on the next sign-in.
    expect(res.setCookie.some((c) => c.startsWith("jf_session="))).toBe(false);

    const user = users[0]!;
    expect(await verifyPassword("a-brand-new-password-9", user.password_hash)).toBe(true);
    expect(user.token_version).toBe(1);
    // A confirmation email went out.
    expect(sentMail.at(-1)!.subject).toMatch(/password/i);
  });

  it("refuses a second use of the same link", async () => {
    await requestReset("person@example.com");
    const token = tokenFromMail();

    const first = await post(
      "/api/auth/password/reset",
      { token, newPassword: "a-brand-new-password-9" },
      await csrfJar(),
    );
    expect(first.status).toBe(200);

    const second = await post(
      "/api/auth/password/reset",
      { token, newPassword: "another-new-password-0" },
      await csrfJar(),
    );
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/invalid or has expired/i);
  });

  it("refuses an expired link", async () => {
    await requestReset("person@example.com");
    // Force the stored row into the past.
    resets[0]!.expires_at = sqlTime(new Date(Date.now() - 60_000));
    const token = tokenFromMail();

    const res = await post(
      "/api/auth/password/reset",
      { token, newPassword: "a-brand-new-password-9" },
      await csrfJar(),
    );
    expect(res.status).toBe(400);
    expect(users[0]!.token_version).toBe(0);
  });

  it("rejects a weak password without consuming the link", async () => {
    await requestReset("person@example.com");
    const token = tokenFromMail();

    const weak = await post(
      "/api/auth/password/reset",
      { token, newPassword: "short" },
      await csrfJar(),
    );
    expect(weak.status).toBe(400);
    expect(resets[0]!.used_at).toBeNull();

    // The same link still works with an acceptable password.
    const ok = await post(
      "/api/auth/password/reset",
      { token, newPassword: "a-brand-new-password-9" },
      await csrfJar(),
    );
    expect(ok.status).toBe(200);
  });
});

describe("POST /api/auth/password/reset/verify", () => {
  it("reports a live token as valid and junk as invalid", async () => {
    await requestReset("person@example.com");
    const token = tokenFromMail();

    const good = await post("/api/auth/password/reset/verify", { token }, await csrfJar());
    expect(good.body).toEqual({ valid: true });

    const bad = await post(
      "/api/auth/password/reset/verify",
      { token: "x".repeat(43) },
      await csrfJar(),
    );
    expect(bad.body).toEqual({ valid: false });
  });
});

describe("administrator controls", () => {
  it("GET /password/forgot reflects the enabled flag", async () => {
    settings.passwordResetEnabled = true;
    expect((await get("/api/auth/password/forgot", new Jar())).body).toEqual({ enabled: true });
    settings.passwordResetEnabled = false;
    expect((await get("/api/auth/password/forgot", new Jar())).body).toEqual({ enabled: false });
  });

  it("mails nothing when self-service reset is disabled, but still answers ok", async () => {
    settings.passwordResetEnabled = false;
    const res = await requestReset("person@example.com");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(sentMail).toHaveLength(0);
  });

  it("honours a role allowlist", async () => {
    settings.passwordResetRoles = ["editor"];
    await requestReset("person@example.com"); // person is an administrator
    expect(sentMail).toHaveLength(0);

    settings.passwordResetRoles = ["administrator"];
    await requestReset("person@example.com");
    expect(sentMail).toHaveLength(1);
  });
});

describe("a completed reset cannot be undone by a stale link", () => {
  it("drops sibling links when the password changes", async () => {
    await requestReset("person@example.com");
    const first = tokenFromMail();
    await requestReset("person@example.com");
    const second = tokenFromMail();
    // Only the most recent link survives minting.
    expect(resets).toHaveLength(1);

    const older = await post(
      "/api/auth/password/reset/verify",
      { token: first },
      await csrfJar(),
    );
    expect(older.body).toEqual({ valid: false });

    const res = await post(
      "/api/auth/password/reset",
      { token: second, newPassword: "a-brand-new-password-9" },
      await csrfJar(),
    );
    expect(res.status).toBe(200);
    expect(resets).toHaveLength(0);
  });
});

/** A jar already carrying a CSRF cookie. */
async function csrfJar(): Promise<Jar> {
  const jar = new Jar();
  await get("/api/auth/csrf", jar);
  return jar;
}
