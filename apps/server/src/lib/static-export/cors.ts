// SPDX-License-Identifier: MIT

/**
 * A statically-hosted export can keep form and comment submission working by
 * POSTing (via `fetch`) back to a running Node origin. That is a cross-origin
 * request, so the origin must answer with CORS headers — but only for origins
 * the operator has vouched for.
 *
 * Allowed:
 *   - `APP_URL` and `STATIC_EXPORT_BASE_URL` (the site's own public origins)
 *   - anything in `STATIC_EXPORT_ALLOWED_ORIGINS` (comma-separated)
 *   - any `http://localhost:<port>` / `http://127.0.0.1:<port>` when not in
 *     production (so `npx serve`'s random port works while testing)
 */

import { getStaticExportConfig, isProxiedHost, stripTrailingSlashes } from "./config.js";

function normalizeOrigin(value: string): string {
  return stripTrailingSlashes(value.trim()).toLowerCase();
}

function allowedOrigins(): Set<string> {
  const out = new Set<string>();
  for (const key of ["APP_URL", "STATIC_EXPORT_BASE_URL"]) {
    const v = process.env[key]?.trim();
    if (v) out.add(normalizeOrigin(v));
  }
  // The operator-configured list, parsed once in config.ts (single source of truth).
  for (const entry of getStaticExportConfig().allowedOrigins) {
    if (entry) out.add(normalizeOrigin(entry));
  }
  return out;
}

const LOOPBACK_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

/** Whether `origin` (an `Origin` header value) may cross-origin POST to the submit endpoints. */
export function isAllowedFormOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  const norm = normalizeOrigin(origin);
  if (allowedOrigins().has(norm)) return true;
  // Loopback is only auto-vouched off a real dev host — never on a proxied
  // production box where `NODE_ENV` may simply be unset (matches resolveCrawlBase).
  if (!isProxiedHost() && LOOPBACK_RE.test(norm)) return true;
  return false;
}

/** Apply CORS headers for an allowed cross-origin submit; returns true if `origin` is allowed. */
export function applyFormCors(
  origin: string | undefined,
  setHeader: (name: string, value: string) => void,
): boolean {
  if (!isAllowedFormOrigin(origin)) return false;
  setHeader("Access-Control-Allow-Origin", origin!);
  setHeader("Vary", "Origin");
  setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
  setHeader("Access-Control-Max-Age", "86400");
  return true;
}
