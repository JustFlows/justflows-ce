/**
 * Signed session cookie using HMAC-SHA256.
 */

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type { Request, Response } from "express";

const COOKIE_NAME = "jf_session";
const TTL_SECONDS = 60 * 60 * 24 * 14;

export interface SessionPayload {
  userId: string;
  siteId: string;
  role: string;
  email: string;
  iat: number;
  /**
   * Bumped in the database whenever every existing session for this user must
   * stop working — a password change, or an explicit "sign out everywhere".
   * The token is stateless, so this counter is the only revocation mechanism;
   * resolveSession compares it against the stored value on every request.
   * Optional so that tokens issued before this field existed still verify.
   */
  tv?: number;
}

const EXAMPLE_SECRETS = new Set([
  "change-me-to-a-long-random-string-at-least-32-characters",
  "please-change-me-to-a-long-random-string-at-least-32-chars",
  "replace-this-with-a-long-random-string",
]);

function secret(): string {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error("APP_SECRET must be at least 32 characters");
  if (process.env.NODE_ENV === "production" && EXAMPLE_SECRETS.has(s)) {
    throw new Error(
      "APP_SECRET is a documented example value. Set a unique secret of at least 32 characters before running in production.",
    );
  }
  return s;
}

const CSRF_COOKIE = "jf_csrf";

function sign(payload: SessionPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verify(token: string): SessionPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;

  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret()).update(data).digest("base64url");

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as SessionPayload;
    if (Date.now() / 1000 - payload.iat > TTL_SECONDS) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createSessionToken(payload: Omit<SessionPayload, "iat">): string {
  return sign({ ...payload, iat: Math.floor(Date.now() / 1000) });
}

export function verifySessionToken(token: string): SessionPayload | null {
  return verify(token);
}

export function getSession(req: Request): SessionPayload | null {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token || typeof token !== "string") return null;
  return verify(token);
}

export function setSessionCookie(res: Response, payload: Omit<SessionPayload, "iat">): void {
  const token = createSessionToken(payload);
  const secure = process.env.NODE_ENV === "production" || (process.env.APP_URL ?? "").startsWith("https://");
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS * 1000,
    secure,
  });
  setCsrfCookie(res, payload.userId);
}

/**
 * Derive the CSRF token from the session rather than generating a fresh random
 * value. A plain double-submit token only proves the caller can read a cookie on
 * this domain, so anyone able to set one — via a subdomain they control, or a
 * cookie-injection bug — could forge both halves. Deriving it from APP_SECRET
 * and the user id means a token is only valid for the session it belongs to.
 */
export function csrfTokenFor(userId: string): string {
  return createHmac("sha256", secret()).update(`csrf:${userId}`).digest("base64url");
}

export function setCsrfCookie(res: Response, userId?: string): void {
  const secure = process.env.NODE_ENV === "production" || (process.env.APP_URL ?? "").startsWith("https://");
  res.cookie(CSRF_COOKIE, userId ? csrfTokenFor(userId) : generateCsrfToken(), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS * 1000,
    secure,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, path: "/" });
  res.clearCookie(CSRF_COOKIE, { httpOnly: false, path: "/" });
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}
