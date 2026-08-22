// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from "express";

/**
 * Public `/api/v1` is consumed by separate frontends. Default is a wide GET
 * allowlist without credentials so a Next.js origin can read published JSON.
 * Preview (`?preview=1`) still uses the session cookie on the same origin.
 */
export function publicApiCors(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Access-Control-Expose-Headers", "X-RateLimit-Remaining");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}
