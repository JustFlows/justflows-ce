import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { csrfTokenFor, getSession } from "../lib/session.js";

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
  if (typeof headerToken !== "string") {
    res.status(403).json({ error: "Invalid CSRF token" });
    return;
  }

  const session = getSession(req);

  // With a session, the token must be the one derived from it — a value an
  // attacker cannot compute even if they can plant a cookie on this domain.
  // Without one (login, logout), fall back to comparing the cookie, which is
  // all a pre-session request can offer, and which still forces the attacker
  // to be able to write a cookie rather than merely submit a form.
  const expected =
    session !== null ? csrfTokenFor(session.userId) : (req.cookies?.[CSRF_COOKIE] as unknown);

  if (typeof expected !== "string" || !expected || !tokensMatch(expected, headerToken)) {
    res.status(403).json({ error: "Invalid CSRF token" });
    return;
  }

  next();
}
