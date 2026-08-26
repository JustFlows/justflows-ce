import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { csrfTokenFor, getSession, syncCsrfCookie } from "../lib/session.js";
import { logSafe } from "../lib/log-safe.js";

const CSRF_COOKIE = "jf_csrf";
const CSRF_HEADER = "x-csrf-token";

/**
 * Paths that run before a session exists, so there is nothing to bind a token
 * to. `/install` is guarded by blockIfInstalled and the first-run window;
 * `/auth/register` by the registration switch and its own rate limits. Login is
 * no longer exempt — see below.
 */
const SKIP_PREFIXES = ["/auth/register", "/install"];

function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }

  const path = req.path;
  if (SKIP_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    next();
    return;
  }

  const headerToken = req.headers[CSRF_HEADER];
  const session = getSession(req);

  if (typeof headerToken !== "string") {
    // Almost always a missing cookie rather than a hostile request: the admin
    // only attaches the header when it can read one. Re-issue so the retry
    // works, and say which case it was — the response cannot, since it is the
    // same 403 either way.
    if (session) syncCsrfCookie(req, res, session);
    console.warn(
      `[justflows] CSRF rejected (no x-csrf-token header): ${logSafe(req.method)} ${logSafe(req.path)}`,
    );
    res.status(403).json({ error: "Invalid CSRF token" });
    return;
  }

  // With a session, the token must be the one derived from it — a value an
  // attacker cannot compute even if they can plant a cookie on this domain.
  // Without one (login, logout), fall back to comparing the cookie, which is
  // all a pre-session request can offer, and which still forces the attacker
  // to be able to write a cookie rather than merely submit a form.
  const expected =
    session !== null
      ? csrfTokenFor(session.userId, Number(session.tv ?? 0))
      : (req.cookies?.[CSRF_COOKIE] as unknown);

  if (typeof expected !== "string" || !expected || !tokensMatch(expected, headerToken)) {
    // A stale token is the expected failure after sessions are revoked, since
    // the derivation includes the revocation counter. Put the cookie back in
    // step so the caller's next attempt succeeds; this request still fails,
    // because a token that no longer matches must not be honoured.
    if (session) syncCsrfCookie(req, res, session);
    console.warn(
      `[justflows] CSRF rejected (token mismatch): ${logSafe(req.method)} ${logSafe(req.path)}`,
    );
    res.status(403).json({ error: "Invalid CSRF token" });
    return;
  }

  next();
}
