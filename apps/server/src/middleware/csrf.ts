import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";

const CSRF_COOKIE = "jf_csrf";
const CSRF_HEADER = "x-csrf-token";

/** Paths (after /api mount) that skip CSRF validation. */
const SKIP_PREFIXES = ["/auth/login", "/auth/register", "/install"];

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

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER];

  if (
    typeof cookieToken !== "string" ||
    typeof headerToken !== "string" ||
    !tokensMatch(cookieToken, headerToken)
  ) {
    res.status(403).json({ error: "Invalid CSRF token" });
    return;
  }

  next();
}
