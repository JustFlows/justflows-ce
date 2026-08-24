import type { NextFunction, Request, Response } from "express";
import { beforeAll, describe, expect, it } from "vitest";

process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";

const { csrfProtection } = await import("../../middleware/csrf.js");
const { createSessionToken, csrfTokenFor, generateCsrfToken } = await import("../session.js");

interface Result {
  status: number | null;
  body: unknown;
  passed: boolean;
}

function run(opts: {
  method?: string;
  path?: string;
  cookies?: Record<string, string>;
  header?: string;
}): Result {
  const result: Result = { status: null, body: null, passed: false };
  const req = {
    method: opts.method ?? "POST",
    path: opts.path ?? "/content",
    cookies: opts.cookies ?? {},
    headers: opts.header === undefined ? {} : { "x-csrf-token": opts.header },
  } as unknown as Request;
  const res = {
    status(code: number) {
      result.status = code;
      return this;
    },
    json(body: unknown) {
      result.body = body;
      return this;
    },
  } as unknown as Response;

  csrfProtection(req, res, (() => {
    result.passed = true;
  }) as NextFunction);

  return result;
}

const USER = "11111111-1111-1111-1111-111111111111";
let sessionCookie: string;
let boundToken: string;

beforeAll(() => {
  sessionCookie = createSessionToken({
    userId: USER,
    siteId: "site-1",
    role: "administrator",
    email: "a@example.com",
  });
  boundToken = csrfTokenFor(USER);
});

describe("csrfProtection with a session", () => {
  it("accepts the token derived from the session", () => {
    const r = run({ cookies: { jf_session: sessionCookie, jf_csrf: boundToken }, header: boundToken });
    expect(r.passed).toBe(true);
  });

  it("accepts even when the cookie is missing, because the header is what is checked", () => {
    const r = run({ cookies: { jf_session: sessionCookie }, header: boundToken });
    expect(r.passed).toBe(true);
  });

  it("rejects a token planted by an attacker who can write cookies on this domain", () => {
    // The classic naive-double-submit bypass: attacker sets both halves to a
    // value they chose. Binding to the session makes the value unguessable.
    const planted = generateCsrfToken();
    const r = run({
      cookies: { jf_session: sessionCookie, jf_csrf: planted },
      header: planted,
    });
    expect(r.passed).toBe(false);
    expect(r.status).toBe(403);
  });

  it("rejects a token bound to a different user", () => {
    const other = csrfTokenFor("22222222-2222-2222-2222-222222222222");
    const r = run({ cookies: { jf_session: sessionCookie, jf_csrf: other }, header: other });
    expect(r.passed).toBe(false);
    expect(r.status).toBe(403);
  });

  it("rejects a missing header", () => {
    const r = run({ cookies: { jf_session: sessionCookie, jf_csrf: boundToken } });
    expect(r.passed).toBe(false);
    expect(r.status).toBe(403);
  });
});

describe("csrfProtection without a session", () => {
  it("falls back to double-submit so login can be protected", () => {
    const token = generateCsrfToken();
    expect(run({ path: "/auth/login", cookies: { jf_csrf: token }, header: token }).passed).toBe(true);
  });

  it("rejects a login post with no cookie at all", () => {
    const r = run({ path: "/auth/login", header: generateCsrfToken() });
    expect(r.passed).toBe(false);
    expect(r.status).toBe(403);
  });

  it("rejects a login post with a mismatched header", () => {
    const r = run({
      path: "/auth/login",
      cookies: { jf_csrf: generateCsrfToken() },
      header: generateCsrfToken(),
    });
    expect(r.passed).toBe(false);
  });
});

describe("csrfProtection exemptions", () => {
  it("never checks safe methods", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(run({ method }).passed).toBe(true);
    }
  });

  it("still exempts the pre-session bootstrap paths", () => {
    expect(run({ path: "/install" }).passed).toBe(true);
    expect(run({ path: "/auth/register" }).passed).toBe(true);
  });

  it("accepts login after the session cookie is gone when the anonymous token is present", () => {
    const token = generateCsrfToken();
    expect(
      run({ path: "/auth/login", cookies: { jf_csrf: token }, header: token }).passed,
    ).toBe(true);
  });

  it("no longer exempts login", () => {
    expect(run({ path: "/auth/login" }).passed).toBe(false);
  });
});
