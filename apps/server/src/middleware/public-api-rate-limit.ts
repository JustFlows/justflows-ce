// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from "express";
import { clientIp, consumeRateLimit } from "../lib/rate-limit.js";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;

/** Cheap per-IP ceiling so a public catalog crawl cannot flood the origin. */
export function publicApiRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "OPTIONS") {
    next();
    return;
  }

  const key = `v1:${clientIp(req)}`;
  if (!consumeRateLimit(key, MAX_REQUESTS, WINDOW_MS)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  next();
}
