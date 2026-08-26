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
    // csrfProtection re-issues a drifted cookie on the way to answering 403.
    cookie() {
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

describe("CSRF token rotation", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const siteId = "22222222-2222-4222-8222-222222222222";

  const sessionAt = (tv: number) =>
    createSessionToken({ userId, siteId, role: "administrator", email: "a@example.com", tv });

  it("derives a different token for each revocation counter", () => {
    const versions = [0, 1, 2, 3].map((tv) => csrfTokenFor(userId, tv));
    expect(new Set(versions).size).toBe(4);
  });

  // The counter is bumped on sign-out, on "sign out everywhere", and on a
  // password change. Keyed on the user id alone the token never changed for the
  // life of the installation, so a value that leaked once stayed valid forever.
  it("rejects a token minted before sessions were revoked", () => {
    const stale = csrfTokenFor(userId, 0);
    const result = run({
      cookies: { jf_session: sessionAt(1), jf_csrf: stale },
      header: stale,
    });
    expect(result.passed).toBe(false);
    expect(result.status).toBe(403);
  });

  it("accepts the token for the current counter", () => {
    const current = csrfTokenFor(userId, 1);
    expect(
      run({ cookies: { jf_session: sessionAt(1), jf_csrf: current }, header: current }).passed,
    ).toBe(true);
  });

  it("treats a token carrying no counter as version zero", () => {
    const token = csrfTokenFor(userId, 0);
    expect(
      run({ cookies: { jf_session: sessionAt(0), jf_csrf: token }, header: token }).passed,
    ).toBe(true);
  });

  it("still refuses a planted cookie when a session is present", () => {
    // The whole point of deriving rather than double-submitting: an attacker who
    // can write a cookie on this domain still cannot compute the token.
    const planted = generateCsrfToken();
    expect(
      run({ cookies: { jf_session: sessionAt(0), jf_csrf: planted }, header: planted }).passed,
    ).toBe(false);
  });
});

describe("a drifted CSRF cookie repairs itself", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const siteId = "22222222-2222-4222-8222-222222222222";

  /** Capture the cookies a handler sets, so we can see the repair happen. */
  function runCapturing(opts: { cookies: Record<string, string>; header?: string }) {
    const setCookies: Record<string, string> = {};
    const req = {
      method: "POST",
      path: "/auth/password",
      cookies: opts.cookies,
      headers: opts.header === undefined ? {} : { "x-csrf-token": opts.header },
    } as unknown as Request;
    let status: number | null = null;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json() {
        return this;
      },
      cookie(name: string, value: string) {
        setCookies[name] = value;
        return this;
      },
    } as unknown as Response;

    let passed = false;
    csrfProtection(req, res, (() => {
      passed = true;
    }) as NextFunction);
    return { status, passed, setCookies };
  }

  const sessionAt = (tv: number) =>
    createSessionToken({ userId, siteId, role: "administrator", email: "a@example.com", tv });

  // The wedge: the derived token rotates with the revocation counter, but the
  // re-issue only fired when the cookie was absent. A cookie that was present
  // and stale was therefore never corrected — every write answered 403 for
  // good, with no way back short of clearing cookies by hand.
  it("re-issues the correct cookie when the stored one is stale", () => {
    const stale = csrfTokenFor(userId, 0);
    const result = runCapturing({
      cookies: { jf_session: sessionAt(3), jf_csrf: stale },
      header: stale,
    });

    // This request still fails — a token that no longer matches is not honoured.
    expect(result.passed).toBe(false);
    expect(result.status).toBe(403);
    // But the cookie is put back in step, so the retry succeeds.
    expect(result.setCookies.jf_csrf).toBe(csrfTokenFor(userId, 3));
  });

  it("re-issues when the header is missing entirely", () => {
    const result = runCapturing({ cookies: { jf_session: sessionAt(2) } });
    expect(result.status).toBe(403);
    expect(result.setCookies.jf_csrf).toBe(csrfTokenFor(userId, 2));
  });

  it("does not hand out a token to an anonymous caller", () => {
    const result = runCapturing({ cookies: {} });
    expect(result.status).toBe(403);
    expect(result.setCookies.jf_csrf).toBeUndefined();
  });

  it("the repaired cookie is accepted on the next attempt", () => {
    const stale = csrfTokenFor(userId, 0);
    const first = runCapturing({
      cookies: { jf_session: sessionAt(3), jf_csrf: stale },
      header: stale,
    });
    const repaired = first.setCookies.jf_csrf!;

    const second = runCapturing({
      cookies: { jf_session: sessionAt(3), jf_csrf: repaired },
      header: repaired,
    });
    expect(second.passed).toBe(true);
  });
});
