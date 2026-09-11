// SPDX-License-Identifier: MIT

import type { Request, RequestHandler, Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { getManageApiRateLimit } from "../lib/manage-api-settings.js";

/**
 * Per-key and per-IP rate limiting for `/api/manage/v1`.
 *
 * `express-rate-limit` is used deliberately: CodeQL's `js/missing-rate-limiting`
 * only recognises this package as a limiter, not the in-process
 * `consumeRateLimit` helper. The ceiling is the key's own `rateLimitPerMin`
 * when set, otherwise the global `manage_api_rate_limit` site setting, and it
 * is read per request so a change takes effect without a restart.
 */

const WINDOW_MS = 60_000;

async function limitFor(req: Request): Promise<number> {
  const perKey = req.apiKey?.rateLimitPerMin;
  if (typeof perKey === "number" && perKey > 0) return perKey;
  return getManageApiRateLimit();
}

function tooMany(_req: Request, res: Response): void {
  if (!res.getHeader("Retry-After")) res.setHeader("Retry-After", String(WINDOW_MS / 1000));
  res.status(429).json({ error: "Too many requests" });
}

const perKey = rateLimit({
  windowMs: WINDOW_MS,
  limit: limitFor,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req: Request) => `key:${req.apiKey?.id ?? "unknown"}`,
  handler: tooMany,
});

const perKeyIp = rateLimit({
  windowMs: WINDOW_MS,
  limit: limitFor,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req: Request) =>
    `key-ip:${req.apiKey?.id ?? "unknown"}:${ipKeyGenerator(req.ip ?? "unknown")}`,
  handler: tooMany,
});

/** Spread into the route chain: `...manageApiRateLimit`. */
export const manageApiRateLimit: RequestHandler[] = [perKey, perKeyIp];
