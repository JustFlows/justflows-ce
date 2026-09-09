// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from "express";
import { getManageApiAllowedOrigins } from "../lib/manage-api-settings.js";

/**
 * CORS for the federated management API.
 *
 * Unlike public `/api/v1`, this surface has writes and authenticated reads, so
 * it never sends `Access-Control-Allow-Origin: *` and never combines a wildcard
 * with credentials. An origin is echoed only when it appears on the key's
 * `allowedOrigins` or the global `manage_api_allowed_origins` list. Server-to-
 * server clients send no `Origin` and need none of this.
 */

const ALLOW_METHODS = "GET, HEAD, POST, PATCH, PUT, DELETE, OPTIONS";
const ALLOW_HEADERS = "Authorization, Content-Type, If-None-Match, If-Match";

function vary(res: Response): void {
  const existing = res.getHeader("Vary");
  res.setHeader("Vary", existing ? `${String(existing)}, Origin` : "Origin");
}

/**
 * Preflight runs before key authentication (browsers send no `Authorization`
 * on an `OPTIONS` preflight), so it can only consult the global allowlist.
 */
export function manageApiPreflight(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "OPTIONS") {
    next();
    return;
  }
  const origin = req.get("origin");
  vary(res);
  getManageApiAllowedOrigins()
    .then((origins) => {
      if (origin && origins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", ALLOW_METHODS);
        res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
        res.setHeader("Access-Control-Max-Age", "600");
      }
      res.status(204).end();
    })
    .catch(next);
}

/**
 * Runs after `apiKeyAuth`, so `req.apiKey` is set. Echoes the request `Origin`
 * only when the key or the global list allows it.
 */
export function manageApiCors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.get("origin");
  if (!origin) {
    next();
    return;
  }
  vary(res);
  const keyOrigins = req.apiKey?.allowedOrigins ?? [];
  getManageApiAllowedOrigins()
    .then((globalOrigins) => {
      if (keyOrigins.includes(origin) || globalOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Expose-Headers", "ETag, RateLimit, Retry-After");
      }
      next();
    })
    .catch(next);
}
