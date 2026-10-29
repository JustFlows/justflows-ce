import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";
process.env.STATE = "INSTALLED";

/**
 * Moving the admin path must hide the staff sign-in, not just the dashboard:
 * the public `/login` and a bare API call must not open a staff session or
 * reveal where the admin lives. Driven through the real routes with one
 * in-memory user row (the same harness as auth-2fa-flow).
 */
interface UserRow {
  id: string;
  site_id: string;
  email: string;
  password_hash: string;
  role: string;
  token_version: number;
  totp_secret: string | null;
  totp_confirmed_at: string | null;
  totp_recovery_codes: string | null;
}

let user: UserRow;
let deviceSessions: Array<{ id: string; user_id: string; site_id: string; expires_at: string; revoked_at: string | null }>;

/**
 * Apply a SET clause.
 *
 * Placeholders are consumed in order and only by assignments that actually have
 * one — `col = NULL` binds no parameter, so counting columns rather than `?`
 * would shift every later value (and silently write the WHERE-clause ids into
 * columns, which is exactly what it did the first time).
 */
function applySet(row: UserRow, setClause: string, params: unknown[]): void {
  let next = 0;
  for (const assignment of setClause.split(",")) {
    const [rawColumn, ...rest] = assignment.split("=");
    const column = rawColumn!.trim();
    const expression = rest.join("=").trim();
    const target = row as unknown as Record<string, unknown>;

    if (expression === "?") {
      target[column] = params[next++] ?? null;
    } else if (/^null$/i.test(expression)) {
      target[column] = null;
    }
    // Anything else (COALESCE, arithmetic) is handled by an earlier branch.
  }
}

/** Minimal SQL interpreter covering only the statements these routes issue. */
const fakeDb = {
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (/FROM users/i.test(sql)) {
      const byEmail = /email = \?/.test(sql);
      // Sign-in scopes the lookup to the site, so the email is not always the first parameter.
      const match = byEmail ? params.includes(user.email) : user.id === params[0];
      return match ? ([{ ...user }] as unknown as T[]) : [];
    }
    if (/FROM sites/i.test(sql)) return [{ id: user.site_id, name: "Test Site" }] as unknown as T[];
    if (/FROM user_sessions/i.test(sql)) {
      const [id, userId, siteId, now] = params as string[];
      return deviceSessions.filter(
        (session) =>
          session.id === id &&
          session.user_id === userId &&
          session.site_id === siteId &&
          !session.revoked_at &&
          (now === undefined || session.expires_at > now),
      ) as unknown as T[];
    }
    return [] as T[];
  },
  async run(sql: string, params: unknown[] = []): Promise<void> {
    if (/^INSERT INTO user_sessions/i.test(sql)) {
      const [id, userId, siteId, , , , , expiresAt] = params as string[];
      deviceSessions.push({
        id: id!,
        user_id: userId!,
        site_id: siteId!,
        expires_at: expiresAt!,
        revoked_at: null,
      });
      return;
    }
    if (/UPDATE users SET token_version/i.test(sql)) {
      user.token_version += 1;
      return;
    }
    const setClause = /UPDATE users SET (.+?) WHERE/i.exec(sql)?.[1];
    if (!setClause) return;
    applySet(user, setClause, params);
  },
  async execute(sql: string, params: unknown[] = []): Promise<number> {
    if (/UPDATE user_sessions SET revoked_at/i.test(sql)) {
      const [revokedAt, id, userId, siteId] = params as string[];
      const session = deviceSessions.find(
        (row) => row.id === id && row.user_id === userId && row.site_id === siteId && !row.revoked_at,
      );
      if (!session) return 0;
      session.revoked_at = revokedAt!;
      return 1;
    }
    return 0;
  },
  async close(): Promise<void> {},
};

vi.mock("../../../../src/lib/database/db.js", () => ({
  getDb: async () => fakeDb,
  getControlDb: async () => fakeDb,
  resetDb: () => {},
}));
vi.mock("../../../../src/lib/email/mail.js", () => ({
  sendMail: async () => ({ ok: true }),
  sendTemplateMail: async () => ({ ok: true }),
  notifyAdmin: async () => ({ ok: true }),
}));
const adminPath = vi.hoisted(() => ({ path: "/admin" }));
vi.mock("../../../../src/lib/admin/admin-path.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/lib/admin/admin-path.js")>()),
  getAdminPathConfig: async () => ({ path: adminPath.path, oldPathBehavior: "not_found" }),
}));
const siteState = vi.hoisted(() => ({ closed: false }));
vi.mock("../../../../src/lib/settings/site-visibility.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/lib/settings/site-visibility.js")>()),
  isSiteClosed: async () => siteState.closed,
}));
vi.mock("../../../../src/lib/plugins/plugin-runtime.js", () => ({
  getRuntimeHooks: () => ({ dispatchAction: async () => {}, has: () => false }),
  ensurePluginRuntime: async () => {},
  getPluginLoader: () => null,
}));

const { default: authRoutes } = await import("../../../../src/routes/auth/auth.js");
const { csrfProtection } = await import("../../../../src/middleware/csrf.js");
const { hashPassword } = await import("../../../../src/lib/auth/password.js");
const { totpCode, base32Encode } = await import("../../../../src/lib/auth/totp.js");
const { encryptSecret } = await import("../../../../src/lib/security/secret-box.js");
const { resetRateLimits } = await import("../../../../src/lib/security/rate-limit.js");

let server: Server;
let base: string;

/** A tiny cookie jar, so the session survives between requests like a browser's. */
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

async function post(path: string, body: unknown, jar: Jar) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const cookie = jar.header();
  if (cookie) headers.cookie = cookie;
  const csrf = jar.get("jf_csrf");
  if (csrf) headers["x-csrf-token"] = decodeURIComponent(csrf);

  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  jar.absorb(res);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}

async function get(path: string, jar: Jar) {
  const headers: Record<string, string> = {};
  const cookie = jar.header();
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${base}${path}`, { headers });
  jar.absorb(res);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
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
  adminPath.path = "/admin";
  siteState.closed = false;
  user = {
    id: "11111111-1111-4111-8111-111111111111",
    site_id: "22222222-2222-4222-8222-222222222222",
    email: "admin@example.com",
    password_hash: await hashPassword("correct-horse-battery"),
    role: "administrator",
    token_version: 0,
    totp_secret: null,
    totp_confirmed_at: null,
    totp_recovery_codes: null,
  };
  deviceSessions = [];
});

/** Sign in far enough to hold a session cookie. */
async function signIn(jar: Jar, extra: Record<string, unknown> = {}) {
  await get("/api/auth/csrf", jar);
  return post(
    "/api/auth/login",
    { email: user.email, password: "correct-horse-battery", ...extra },
    jar,
  );
}

describe("staff sign-in once the admin path is moved", () => {
  it("refuses staff on the public sign-in on the default path, exactly like a wrong password", async () => {
    const jar = new Jar();
    const staff = await signIn(jar);
    resetRateLimits();
    const wrong = await signIn(new Jar(), { password: "not-the-password" });
    expect(staff.status).toBe(401);
    expect(staff.body).toEqual(wrong.body);
    expect(JSON.stringify(staff.body)).not.toContain("admin");
    expect(jar.get("jf_session")).toBeUndefined();
  });

  it("opens a staff session from /admin/login on the default path", async () => {
    const jar = new Jar();
    const res = await signIn(jar, { adminPath: "/admin" });
    expect(res.status).toBe(200);
    expect(res.body.redirectTo).toBe("/admin");
  });

  it("refuses a staff account on the public sign-in exactly like a wrong password", async () => {
    adminPath.path = "/control-room";
    const jar = new Jar();
    const staff = await signIn(jar);
    resetRateLimits();
    const wrong = await signIn(new Jar(), { password: "not-the-password" });

    expect(staff.status).toBe(401);
    expect(staff.body).toEqual(wrong.body);
    expect(JSON.stringify(staff.body)).not.toContain("control-room");
    expect(jar.get("jf_session")).toBeUndefined();
  });

  it("does not reveal a correct staff password through the second-factor prompt", async () => {
    adminPath.path = "/control-room";
    user.totp_secret = encryptSecret(base32Encode(Buffer.alloc(20, 7)));
    user.totp_confirmed_at = "2026-01-01 00:00:00";
    const res = await signIn(new Jar());
    expect(res.status).toBe(401);
    expect(res.body.totpRequired).toBeUndefined();
    // The same account through the hidden page is asked for its code.
    resetRateLimits();
    const hidden = await signIn(new Jar(), { adminPath: "/control-room" });
    expect(hidden.body.totpRequired).toBe(true);
  });

  it("refuses a guessed admin path", async () => {
    adminPath.path = "/control-room";
    const res = await signIn(new Jar(), { adminPath: "/admin" });
    expect(res.status).toBe(401);
  });

  it("opens a staff session from the hidden sign-in page", async () => {
    adminPath.path = "/control-room";
    const jar = new Jar();
    const res = await signIn(jar, { adminPath: "/control-room" });
    expect(res.status).toBe(200);
    expect(res.body.redirectTo).toBe("/control-room");
    expect(jar.get("jf_session")).toBeTruthy();
  });

  it("still lets a member sign in on the public page", async () => {
    adminPath.path = "/control-room";
    user.role = "subscriber";
    const res = await signIn(new Jar());
    expect(res.status).toBe(200);
    expect(res.body.redirectTo).not.toContain("control-room");
  });
});

describe("one session for the admin and the site", () => {
  it("marks a staff sign-in from the admin page as signed in on the site too", async () => {
    adminPath.path = "/control-room";
    const jar = new Jar();
    expect((await signIn(jar, { adminPath: "/control-room" })).status).toBe(200);
    expect(jar.get("jf_signed_in")).toBe("1");

    const status = await get("/api/auth/status", jar);
    expect(status.body).toMatchObject({ signedIn: true, email: user.email });
    expect(JSON.stringify(status.body)).not.toContain("control-room");
  });

  it("answers an anonymous visitor without a 401 and clears a stale hint", async () => {
    const res = await fetch(`${base}/api/auth/status`, { headers: { cookie: "jf_signed_in=1" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedIn: false });
    expect(res.headers.getSetCookie().some((cookie) => cookie.startsWith("jf_signed_in=;"))).toBe(true);
  });

  it("signing out anywhere clears the hint with the session", async () => {
    const jar = new Jar();
    await signIn(jar, { adminPath: "/admin" });
    await post("/api/auth/logout", {}, jar);
    expect(jar.get("jf_signed_in")).toBe("");
    expect((await get("/api/auth/status", jar)).body).toEqual({ signedIn: false });
  });
});

describe("while the site is offline or in maintenance", () => {
  beforeEach(() => { siteState.closed = true; adminPath.path = "/control-room"; });

  it("closes the member sign-in with one answer for every account", async () => {
    user.role = "subscriber";
    const member = await signIn(new Jar());
    resetRateLimits();
    const unknown = await signIn(new Jar(), { email: "nobody@example.com" });
    expect(member.status).toBe(503);
    expect(member.body).toEqual(unknown.body);
  });

  it("closes member registration and password reset", async () => {
    const jar = new Jar();
    await get("/api/auth/csrf", jar);
    expect((await post("/api/auth/register", { email: "new@example.com", username: "newbie", password: "a-long-enough-passphrase" }, jar)).status).toBe(503);
    expect((await post("/api/auth/password/forgot", { email: user.email }, jar)).status).toBe(503);
    expect((await post("/api/auth/password/reset/verify", { token: "x".repeat(32) }, jar)).status).toBe(503);
    expect((await post("/api/auth/password/reset", { token: "x".repeat(32), newPassword: "a-long-enough-passphrase" }, jar)).status).toBe(503);
  });

  it("keeps the staff sign-in under the admin path open", async () => {
    const jar = new Jar();
    const res = await signIn(jar, { adminPath: "/control-room" });
    expect(res.status).toBe(200);
    expect(res.body.redirectTo).toBe("/control-room");
  });

  it("does not open the member side for a guessed admin path", async () => {
    const res = await signIn(new Jar(), { adminPath: "/admin" });
    expect(res.status).toBe(503);
  });
});
