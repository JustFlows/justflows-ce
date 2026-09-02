import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";
process.env.STATE = "INSTALLED";

/**
 * Admin → Users end to end: sign in as a real account, then exercise the
 * CRUD routes through the real middleware stack (session, CSRF, role checks).
 * The interesting behaviour here is authorization and the last-administrator
 * guard, neither of which a unit test of the handler in isolation would catch.
 */
interface UserRow {
  id: string;
  site_id: string;
  email: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: string;
  token_version: number;
  created_at: string;
}

const SITE_ID = "22222222-2222-4222-8222-222222222222";
let users: UserRow[];

function findById(id: unknown): UserRow | undefined {
  return users.find((u) => u.id === id);
}

/** Apply a `col = ?, col2 = ?` SET clause to a row, in parameter order. */
function applySet(row: UserRow, setClause: string, params: unknown[]): void {
  const columns = setClause.split(",").map((assignment) => assignment.split("=")[0]!.trim());
  columns.forEach((column, i) => {
    (row as unknown as Record<string, unknown>)[column] = params[i];
  });
}

/** Minimal SQL interpreter covering only the statements auth + users routes issue. */
const fakeDb = {
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (/FROM sites/i.test(sql)) return [] as T[];

    if (/COUNT\(\*\) as count FROM users WHERE site_id = \? AND role = 'administrator'/i.test(sql)) {
      const [siteId] = params;
      const count = users.filter((u) => u.site_id === siteId && u.role === "administrator").length;
      return [{ count }] as unknown as T[];
    }
    if (/FROM users WHERE site_id = \? ORDER BY created_at/i.test(sql)) {
      const [siteId] = params;
      return users.filter((u) => u.site_id === siteId) as unknown as T[];
    }
    if (/FROM users WHERE email = \?/i.test(sql)) {
      const [email] = params;
      const row = users.find((u) => u.email === email);
      return row ? ([{ ...row }] as unknown as T[]) : [];
    }
    if (/FROM users WHERE id = \?/i.test(sql)) {
      const [id] = params;
      const row = findById(id);
      return row ? ([{ ...row }] as unknown as T[]) : [];
    }
    return [] as T[];
  },
  async run(sql: string, params: unknown[] = []): Promise<void> {
    if (/DELETE FROM users WHERE id = \? AND site_id = \?/i.test(sql)) {
      const [id, siteId] = params;
      users = users.filter((u) => !(u.id === id && u.site_id === siteId));
      return;
    }
    const setClause = /UPDATE users SET (.+?) WHERE/i.exec(sql)?.[1];
    if (setClause) {
      const id = params[params.length - 2];
      const row = findById(id);
      if (row) applySet(row, setClause, params);
    }
  },
  async close(): Promise<void> {},
};

vi.mock("../db.js", () => ({
  getDb: async () => fakeDb,
  resetDb: () => {},
}));
vi.mock("../mail.js", () => ({
  sendMail: async () => ({ ok: true }),
  sendTemplateMail: async () => ({ ok: true }),
  notifyAdmin: async () => ({ ok: true }),
}));
vi.mock("../plugin-runtime.js", () => ({
  getRuntimeHooks: () => ({ dispatchAction: async () => {}, has: () => false }),
  ensurePluginRuntime: async () => {},
  getPluginLoader: () => null,
}));

const { default: authRoutes } = await import("../../routes/auth.js");
const { default: usersRoutes } = await import("../../routes/users.js");
const { csrfProtection } = await import("../../middleware/csrf.js");
const { hashPassword } = await import("../password.js");
const { resetRateLimits } = await import("../rate-limit.js");

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

async function request(method: string, path: string, body: unknown, jar: Jar) {
  const headers: Record<string, string> = {};
  const cookie = jar.header();
  if (cookie) headers.cookie = cookie;
  const csrf = jar.get("jf_csrf");
  if (csrf) headers["x-csrf-token"] = decodeURIComponent(csrf);
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  jar.absorb(res);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}

const get = (path: string, jar: Jar) => request("GET", path, undefined, jar);
const post = (path: string, body: unknown, jar: Jar) => request("POST", path, body, jar);
const patch = (path: string, body: unknown, jar: Jar) => request("PATCH", path, body, jar);
const del = (path: string, jar: Jar) => request("DELETE", path, undefined, jar);

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
  app.use("/api/users", usersRoutes);
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
});

const PASSWORD = "correct-horse-battery";

async function makeUser(overrides: Partial<UserRow>): Promise<UserRow> {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    site_id: SITE_ID,
    email: overrides.email ?? "user@example.com",
    username: overrides.username ?? "user",
    display_name: overrides.display_name ?? "User",
    password_hash: await hashPassword(PASSWORD),
    role: overrides.role ?? "subscriber",
    token_version: 0,
    created_at: "2026-01-01 00:00:00",
    ...overrides,
  };
}

let admin1: UserRow;

beforeEach(async () => {
  resetRateLimits();
  admin1 = await makeUser({ id: "admin-1", email: "admin1@example.com", role: "administrator", display_name: "Admin One" });
  users = [admin1];
});

async function signIn(email: string, jar: Jar) {
  await get("/api/auth/csrf", jar);
  return post("/api/auth/login", { email, password: PASSWORD }, jar);
}

describe("GET /api/auth/me", () => {
  it("reports the signed-in account's id, email and role", async () => {
    const jar = new Jar();
    await signIn(admin1.email, jar);

    const res = await get("/api/auth/me", jar);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: admin1.id, email: admin1.email, role: "administrator" });
  });

  it("401s without a session", async () => {
    const res = await get("/api/auth/me", new Jar());
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/login", () => {
  it("returns the account's role, so the client knows where to send the browser", async () => {
    const member = await makeUser({ id: "member-1", email: "member@example.com", role: "subscriber" });
    users.push(member);
    const jar = new Jar();

    const res = await signIn(member.email, jar);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("subscriber");
  });
});

describe("authorization", () => {
  it("blocks a non-admin from updating a user", async () => {
    const editor = await makeUser({ id: "editor-1", email: "editor@example.com", role: "editor" });
    users.push(editor);
    const jar = new Jar();
    expect((await signIn(editor.email, jar)).status).toBe(200);

    const res = await patch(`/api/users/${admin1.id}`, { displayName: "Hacked" }, jar);
    expect(res.status).toBe(403);
    expect(findById(admin1.id)?.display_name).toBe("Admin One");
  });

  it("blocks a non-admin from deleting a user", async () => {
    const editor = await makeUser({ id: "editor-1", email: "editor@example.com", role: "editor" });
    const member = await makeUser({ id: "member-1", email: "member@example.com", role: "subscriber" });
    users.push(editor, member);
    const jar = new Jar();
    await signIn(editor.email, jar);

    const res = await del(`/api/users/${member.id}`, jar);
    expect(res.status).toBe(403);
    expect(findById(member.id)).toBeTruthy();
  });

  it("lets an editor read the user list and a single user", async () => {
    const editor = await makeUser({ id: "editor-1", email: "editor@example.com", role: "editor" });
    users.push(editor);
    const jar = new Jar();
    await signIn(editor.email, jar);

    expect((await get("/api/users", jar)).status).toBe(200);
    expect((await get(`/api/users/${admin1.id}`, jar)).status).toBe(200);
  });
});

describe("GET /api/users/:id", () => {
  it("returns the user", async () => {
    const jar = new Jar();
    await signIn(admin1.email, jar);
    const res = await get(`/api/users/${admin1.id}`, jar);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: admin1.id, email: admin1.email, role: "administrator" });
  });

  it("404s for an unknown id", async () => {
    const jar = new Jar();
    await signIn(admin1.email, jar);
    const res = await get("/api/users/does-not-exist", jar);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/users/:id", () => {
  it("updates display name and role", async () => {
    const member = await makeUser({ id: "member-1", email: "member@example.com", role: "subscriber" });
    users.push(member);
    const jar = new Jar();
    await signIn(admin1.email, jar);

    const res = await patch(`/api/users/${member.id}`, { displayName: "New Name", role: "editor" }, jar);
    expect(res.status).toBe(200);
    expect(findById(member.id)).toMatchObject({ display_name: "New Name", role: "editor" });
  });

  it("blocks demoting the sole administrator, including self-demotion", async () => {
    const jar = new Jar();
    await signIn(admin1.email, jar);

    const res = await patch(`/api/users/${admin1.id}`, { role: "editor" }, jar);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/last administrator/i);
    expect(findById(admin1.id)?.role).toBe("administrator");
  });

  it("allows demoting an administrator when another one remains", async () => {
    const admin2 = await makeUser({ id: "admin-2", email: "admin2@example.com", role: "administrator" });
    users.push(admin2);
    const jar = new Jar();
    await signIn(admin1.email, jar);

    const res = await patch(`/api/users/${admin2.id}`, { role: "editor" }, jar);
    expect(res.status).toBe(200);
    expect(findById(admin2.id)?.role).toBe("editor");
  });

  it("404s when patching an unknown id with a role change", async () => {
    const jar = new Jar();
    await signIn(admin1.email, jar);
    const res = await patch("/api/users/does-not-exist", { role: "editor" }, jar);
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/users/:id", () => {
  it("blocks deleting yourself", async () => {
    const jar = new Jar();
    await signIn(admin1.email, jar);
    const res = await del(`/api/users/${admin1.id}`, jar);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot delete yourself/i);
    expect(findById(admin1.id)).toBeTruthy();
  });

  it("removes a non-administrator", async () => {
    const member = await makeUser({ id: "member-1", email: "member@example.com", role: "subscriber" });
    users.push(member);
    const jar = new Jar();
    await signIn(admin1.email, jar);

    const res = await del(`/api/users/${member.id}`, jar);
    expect(res.status).toBe(200);
    expect(findById(member.id)).toBeUndefined();
  });

  it("allows removing an administrator when another one remains", async () => {
    const admin2 = await makeUser({ id: "admin-2", email: "admin2@example.com", role: "administrator" });
    users.push(admin2);
    const jar = new Jar();
    await signIn(admin1.email, jar);

    const res = await del(`/api/users/${admin2.id}`, jar);
    expect(res.status).toBe(200);
    expect(findById(admin2.id)).toBeUndefined();
  });

  it("404s for an unknown id", async () => {
    const jar = new Jar();
    await signIn(admin1.email, jar);
    const res = await del("/api/users/does-not-exist", jar);
    expect(res.status).toBe(404);
  });
});
