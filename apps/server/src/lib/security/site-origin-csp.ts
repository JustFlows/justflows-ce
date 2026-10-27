// SPDX-License-Identifier: MIT

import { getJfCache } from "../cache/jf-cache.js";
import { getControlDb } from "../database/db.js";
import { getSiteId } from "../settings/site-settings.js";
import { isValidHostname } from "../tenancy/host.js";

const CACHE_TTL_SECONDS = 30;
const CACHE_KEY = "security-headers:site-origins";

/**
 * Directives that name hosts. `frame-ancestors` is handled separately: the
 * admin policy is `'none'` and must stay that way.
 */
const WIDEN = new Set([
  "default-src",
  "script-src",
  "script-src-elem",
  "script-src-attr",
  "style-src",
  "style-src-elem",
  "style-src-attr",
  "img-src",
  "font-src",
  "connect-src",
  "frame-src",
  "media-src",
  "manifest-src",
  "worker-src",
  "child-src",
  "form-action",
  "prefetch-src",
]);

export interface SiteHostRow {
  hostname: string;
  kind: string;
  status?: string | null;
}

/** `https://host` for a hostname this process is willing to put in a CSP source list. */
export function cspOrigin(hostname: string): string | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.includes("*") || !isValidHostname(host)) return null;
  const origin = `https://${host}`;
  try {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password) return null;
  } catch {
    return null;
  }
  return origin;
}

/**
 * Origins the browser may treat as this website.
 * The platform address is always included. A custom domain is included only
 * once it is connected — a pending name is not yet proof the site owns it.
 */
export function siteHostsForCsp(rows: readonly SiteHostRow[]): string[] {
  const origins: string[] = [];
  for (const row of rows) {
    if (row.kind === "custom" && row.status !== "active") continue;
    const origin = cspOrigin(row.hostname);
    if (origin && !origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

function locked(sources: string[]): boolean {
  return sources.some((source) => source.toLowerCase() === "'none'");
}

/**
 * Add this site's own origins to a Content-Security-Policy.
 *
 * `'self'` is only the host that served the document. The admin stays on the
 * platform address while the public site is served from the custom primary
 * domain, so a script, fetch, or preview frame aimed at the other address is
 * cross-origin. Connected addresses are appended to the directives that
 * already list hosts. A directive that is `'none'` is left alone.
 *
 * `frameAncestors` is for the public site, so the admin can frame it. The
 * admin document keeps `frame-ancestors 'none'`.
 */
export function withSiteOriginCsp(
  csp: string,
  origins: readonly string[],
  options: { frameAncestors: boolean },
): string {
  const extra: string[] = [];
  for (const origin of origins) {
    try {
      if (cspOrigin(new URL(origin).hostname) === origin) extra.push(origin);
    } catch {
      // A source that is not an absolute https origin is ignored.
    }
  }
  if (!extra.length) return csp;

  const parts = csp.split(";").map((part) => part.trim()).filter(Boolean);
  const order: string[] = [];
  const byName = new Map<string, string[]>();
  for (const part of parts) {
    const [name, ...rest] = part.split(/\s+/);
    if (!name) continue;
    const key = name.toLowerCase();
    if (!byName.has(key)) order.push(key);
    byName.set(key, [...(byName.get(key) ?? []), ...rest]);
  }

  const widen = (key: string) => {
    const existing = byName.get(key);
    if (!existing || locked(existing)) return;
    const next = [...existing];
    for (const source of extra) {
      if (!next.some((item) => item.toLowerCase() === source.toLowerCase())) next.push(source);
    }
    byName.set(key, next);
  };

  for (const key of order) {
    if (WIDEN.has(key)) widen(key);
  }
  if (options.frameAncestors) widen("frame-ancestors");

  return order.map((key) => [key, ...(byName.get(key) ?? [])].join(" ")).join("; ");
}

/**
 * True when an enforcing policy names a real origin in `frame-ancestors`.
 *
 * `X-Frame-Options: SAMEORIGIN` cannot list that origin. Chrome still applies
 * it, so a theme preview on the platform address is refused even after
 * `frame-ancestors` allows the frame. The caller drops `X-Frame-Options` and
 * leaves the allow-list to `frame-ancestors`.
 */
export function frameAncestorsListsOrigins(csp: string): boolean {
  const directive = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => /^frame-ancestors(?:\s|$)/i.test(part));
  if (!directive) return false;
  return directive.split(/\s+/).slice(1).some((source) => /^https:\/\//i.test(source));
}

/** True when two of the site's hosts are not the same site to the browser. */
export function hostsSpanSites(origins: readonly string[]): boolean {
  const hosts: string[] = [];
  for (const origin of origins) {
    try {
      hosts.push(new URL(origin).hostname.toLowerCase());
    } catch {
      // Ignore a source that is not an absolute origin.
    }
  }
  for (let i = 0; i < hosts.length; i++) {
    for (let j = i + 1; j < hosts.length; j++) {
      const a = hosts[i]!;
      const b = hosts[j]!;
      if (a !== b && !a.endsWith(`.${b}`) && !b.endsWith(`.${a}`)) return true;
    }
  }
  return false;
}

/**
 * `same-site` does not cover a custom domain: `noobbase.com` and
 * `noobbase.justflows.com` are different sites. Scripts and fetches between
 * them need `cross-origin`, or the browser blocks the response after CSP
 * has allowed the request.
 */
export function crossOriginResourcePolicyForHosts(value: string, origins: readonly string[]): string {
  const policy = value.trim().toLowerCase();
  if (policy !== "same-origin" && policy !== "same-site") return value;
  return hostsSpanSites(origins) ? "cross-origin" : value;
}

async function loadSiteCspOrigins(siteId: string): Promise<string[]> {
  const db = await getControlDb();
  const rows = await db.query<SiteHostRow>(
    "SELECT hostname, kind, status FROM site_domains WHERE site_id = ?",
    [siteId],
  );
  return siteHostsForCsp(rows);
}

/** Connected origins for the site handling this request. Empty when unknown. */
export async function getSiteCspOrigins(): Promise<string[]> {
  const siteId = await getSiteId();
  if (!siteId) return [];
  try {
    return await getJfCache().remember(CACHE_KEY, CACHE_TTL_SECONDS, () => loadSiteCspOrigins(siteId));
  } catch {
    return [];
  }
}

/** Drop the cached origin list. The next request reads `site_domains` again. */
export function invalidateSiteOriginCsp(): void {
  void getJfCache().delete(CACHE_KEY);
}
