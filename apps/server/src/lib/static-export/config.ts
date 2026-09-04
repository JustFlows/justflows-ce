// SPDX-License-Identifier: MIT

import path from "node:path";
import { parseEnvBool } from "@justflows/core";
import { getJfRoot } from "../jf-root.js";

/** Resolved `STATIC_EXPORT_*` configuration for one export run. */
export interface StaticExportConfig {
  /**
   * Master switch. When false the admin "Run" actions and the auto-rebuild are
   * refused; the exporter is dormant. Default true (available, run on demand).
   */
  enabled: boolean;
  /** Absolute directory the filesystem adapter writes into. */
  outDir: string;
  /**
   * Origin the crawler fetches from. Loopback in dev; on production it resolves
   * to `STATIC_EXPORT_CRAWL_URL` / `APP_URL` so a proxied host (Passenger, Plesk)
   * is crawled by its real domain, not an unreachable `127.0.0.1:PORT`.
   */
  baseUrl: string;
  /** Public origin written into the manifest / used for absolute-URL rewriting. */
  publicUrl: string;
  /**
   * Origin that keeps serving the dynamic endpoints (form + comment POST) for a
   * static deployment. When set, `<form action>` in the exported HTML is
   * rewritten to absolute URLs against it. Empty = leave actions relative.
   */
  originUrl: string;
  /**
   * Origins allowed to cross-origin `fetch()` the submit endpoints (CORS). The
   * site's own `APP_URL` / `STATIC_EXPORT_BASE_URL` and, off production,
   * `localhost` are always allowed; this adds more. Comma-separated in the env.
   */
  allowedOrigins: string[];
  /** Hard ceiling on crawled pages, so a link loop cannot run forever. */
  maxPages: number;
  /** Parallel in-flight fetches during the crawl. */
  concurrency: number;
  /** Re-run an incremental export when `cache.revalidated` fires. */
  auto: boolean;
  /** Quiet period (ms) that coalesces a burst of revalidations into one run. */
  debounceMs: number;
}

/**
 * Parse an integer env var, clamped to `[min, max]`. Exported so the Tools
 * settings reader coerces `.env` values exactly the way an export run does —
 * otherwise the form and the run disagree on an out-of-range value.
 */
export function intFromEnv(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * Strip trailing "/" with a linear scan. `/\/+$/` is a polynomial-time match on
 * a long run of slashes (CodeQL `js/polynomial-redos`), and this runs on
 * request-body and `Origin`-header values.
 */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* "/" */) end--;
  return value.slice(0, end);
}

function trimSlash(value: string): string {
  return stripTrailingSlashes(value);
}

/**
 * A host where the app has no reachable loopback TCP port (Passenger on Plesk /
 * cPanel) — treated like production even when `NODE_ENV` is unset, so loopback
 * shortcuts (dev crawl base, permissive CORS) are not taken there.
 */
export function isProxiedHost(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    !!(
      process.env.PASSENGER_APP_ENV ||
      process.env.PASSENGER_LISTEN_PORT ||
      process.env.PHUSION_PASSENGER
    )
  );
}

/**
 * The origin the crawler fetches bytes from. Precedence:
 *
 *   1. an explicit override — CLI `--base-url`, the admin request body, or (off
 *      production) the loopback port the admin request arrived on;
 *   2. `STATIC_EXPORT_CRAWL_URL` — this site's own origin addressed however it is
 *      actually reachable from the server process. Behind Passenger / Plesk the
 *      app has no loopback TCP port, so point this at the real domain;
 *   3. on production, `APP_URL` (the origin that renders pages) then
 *      `STATIC_EXPORT_BASE_URL` — never a bare loopback IP, which does not
 *      resolve to this app on a proxied host;
 *   4. loopback on `PORT` — the self-contained default for dev and plain Node.
 */
function resolveCrawlBase(override: string | undefined, port: number): string {
  // Passenger (Plesk, cPanel) gives the app no reachable loopback TCP port, so
  // treat it like production even if NODE_ENV is unset.
  const proxied = isProxiedHost();
  const candidates = [
    override,
    process.env.STATIC_EXPORT_CRAWL_URL?.trim(),
    proxied ? process.env.APP_URL?.trim() : "",
    proxied ? process.env.STATIC_EXPORT_BASE_URL?.trim() : "",
  ];
  for (const candidate of candidates) {
    if (candidate) return trimSlash(candidate);
  }
  return `http://127.0.0.1:${port}`;
}

/** Origins the operator has explicitly declared as this site's own. */
function configuredCrawlOrigins(): string[] {
  return [
    process.env.APP_URL,
    process.env.STATIC_EXPORT_BASE_URL,
    process.env.STATIC_EXPORT_CRAWL_URL,
    ...(process.env.STATIC_EXPORT_ALLOWED_ORIGINS ?? "").split(","),
  ]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v));
}

/**
 * Resolve `raw` to an origin the exporter is allowed to fetch from, or throw.
 *
 * The exporter only ever crawls *this* site, so the target must be loopback
 * (any port — dev) or exactly an origin the operator configured (`APP_URL`,
 * `STATIC_EXPORT_BASE_URL`, `STATIC_EXPORT_CRAWL_URL`,
 * `STATIC_EXPORT_ALLOWED_ORIGINS`). An admin "Run" request body and any env
 * value both pass through here, so a compromised admin session or a stray env
 * cannot turn the crawler into an SSRF probe / DoS cannon against another host.
 * Returns a normalized `scheme://host[:port]`.
 */
export function assertExportOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`crawl origin is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`crawl origin must use http(s): ${raw}`);
  }

  // Reassemble the origin from values that do NOT carry `raw` forward: a scheme
  // literal, an allow-listed host literal, and a numerically-parsed port. What
  // the crawler fetches is therefore fully decoupled from the caller's string
  // (SSRF / DoS hardening).
  const scheme = url.protocol === "https:" ? "https" : "http";
  const portNum = Number(url.port);
  const port = Number.isInteger(portNum) && portNum > 0 && portNum <= 65535 ? `:${portNum}` : "";

  // `URL` keeps IPv6 hosts bracketed (`[::1]`); accept both spellings. Values
  // are literals, so nothing from `raw` reaches the return.
  const LOOPBACK: Record<string, string> = {
    localhost: "localhost",
    "127.0.0.1": "127.0.0.1",
    "::1": "[::1]",
    "[::1]": "[::1]",
  };
  const loopbackHost = LOOPBACK[url.hostname.toLowerCase()];
  if (loopbackHost) return `${scheme}://${loopbackHost}${port}`;

  for (const entry of configuredCrawlOrigins()) {
    let configured: URL;
    try {
      configured = new URL(entry);
    } catch {
      continue;
    }
    if (configured.protocol === url.protocol && configured.host === url.host) {
      // Return the operator-configured origin, built from its own (env) parts.
      const cScheme = configured.protocol === "https:" ? "https" : "http";
      const cPortNum = Number(configured.port);
      const cPort =
        Number.isInteger(cPortNum) && cPortNum > 0 && cPortNum <= 65535 ? `:${cPortNum}` : "";
      return `${cScheme}://${configured.hostname}${cPort}`;
    }
  }
  throw new Error(`crawl origin ${raw} is not loopback or an origin configured for this site`);
}

/**
 * Read configuration from the environment. The exporter always crawls the site's
 * own running server so the output matches what a visitor receives; `baseUrl`
 * (see {@link resolveCrawlBase}) is loopback on `PORT` in dev and the real
 * domain on production.
 */
export function getStaticExportConfig(
  overrides: Partial<StaticExportConfig> = {},
): StaticExportConfig {
  const port = intFromEnv(process.env.PORT, 3000, 1, 65535);
  const jfRoot = getJfRoot();
  const defaultDir = path.resolve(jfRoot, "static-export");
  const configuredDir = process.env.STATIC_EXPORT_DIR?.trim();
  const publicUrl = trimSlash(
    process.env.STATIC_EXPORT_BASE_URL?.trim() || process.env.APP_URL?.trim() || "",
  );

  // The export directory is written to and recursively cleared, so a
  // configured value that resolves outside the app root (`.`, `..`, `/var/www`)
  // is rejected in favour of the safe default rather than trusted.
  const resolveOutDir = (value: string, base: string): string => {
    const abs = path.resolve(base, value);
    const rel = path.relative(jfRoot, abs);
    if (rel === "" || rel === "." || rel.startsWith("..") || path.isAbsolute(rel))
      return defaultDir;
    return abs;
  };

  return {
    enabled: overrides.enabled ?? parseEnvBool(process.env.STATIC_EXPORT_ENABLED, true),
    outDir: overrides.outDir
      ? resolveOutDir(overrides.outDir, process.cwd())
      : configuredDir
        ? resolveOutDir(configuredDir, jfRoot)
        : defaultDir,
    baseUrl: resolveCrawlBase(overrides.baseUrl, port),
    publicUrl: overrides.publicUrl !== undefined ? trimSlash(overrides.publicUrl) : publicUrl,
    originUrl:
      overrides.originUrl !== undefined
        ? trimSlash(overrides.originUrl)
        : trimSlash(process.env.STATIC_EXPORT_ORIGIN_URL?.trim() || ""),
    allowedOrigins:
      overrides.allowedOrigins ??
      (process.env.STATIC_EXPORT_ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((s) => trimSlash(s.trim()))
        .filter(Boolean),
    maxPages:
      overrides.maxPages ?? intFromEnv(process.env.STATIC_EXPORT_MAX_PAGES, 2000, 1, 100_000),
    concurrency:
      overrides.concurrency ?? intFromEnv(process.env.STATIC_EXPORT_CONCURRENCY, 4, 1, 32),
    auto: overrides.auto ?? parseEnvBool(process.env.STATIC_EXPORT_AUTO, false),
    debounceMs:
      overrides.debounceMs ?? intFromEnv(process.env.STATIC_EXPORT_DEBOUNCE_MS, 5000, 250, 600_000),
  };
}

/** Header the crawler sends so the origin can skip analytics / preview / toolbars. */
export const STATIC_EXPORT_HEADER = "x-jf-static-export";

/** Manifest filename at the root of the output directory. */
export const MANIFEST_FILE = "_static-export.json";
