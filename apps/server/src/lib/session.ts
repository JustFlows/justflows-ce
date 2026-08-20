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
  setCsrfCookie(res);
}

export function setCsrfCookie(res: Response): void {
  const secure = process.env.NODE_ENV === "production" || (process.env.APP_URL ?? "").startsWith("https://");
  res.cookie(CSRF_COOKIE, generateCsrfToken(), {
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
