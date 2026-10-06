// SPDX-License-Identifier: MIT

import { getControlDb } from "../database/db.js";
import { getTenantContext } from "../tenancy/context.js";
import { loadActiveCdn, type ActiveCdn } from "./cdn-settings.js";
import { CdnProviderError } from "./providers/index.js";

const SITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const COOLDOWN_MS = 1500;
const lastPurgeAt = new Map<string, number>();

/** Wildcard URL a CDN accepts as a prefix purge. Local hosts are skipped. */
export function cdnPurgeUrl(hostname: string): string | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
  if (!HOSTNAME.test(host)) return null;
  if (host === "localhost" || host.endsWith(".localhost") || host.startsWith("127.")) return null;
  return `https://${host}/*`;
}

export function resetCdnPurgeCooldown(): void {
  lastPurgeAt.clear();
}

async function hostnamesFor(siteId: string | undefined, hostname: string | undefined): Promise<string[]> {
  const hosts = new Set<string>();
  if (hostname) hosts.add(hostname);
  const current = getTenantContext()?.hostname;
  if (current) hosts.add(current);
  if (siteId && SITE_ID.test(siteId)) {
    try {
      const db = await getControlDb();
      const rows = await db.query<{ hostname: string }>(
        "SELECT hostname FROM site_domains WHERE site_id = ?",
        [siteId],
      );
      for (const row of rows) hosts.add(String(row.hostname));
    } catch (err) {
      console.error(
        "[cdn] could not list site hostnames:",
        err instanceof Error ? err.message : "unknown error",
      );
    }
  }
  return [...hosts];
}

/** The `https://<host>/*` prefixes that cover one site. */
export async function sitePurgeUrls(siteId?: string, hostname?: string): Promise<string[]> {
  return [
    ...new Set(
      (await hostnamesFor(siteId, hostname))
        .map((host) => cdnPurgeUrl(host))
        .filter((url): url is string => url !== null),
    ),
  ];
}

function logFailure(active: ActiveCdn, err: unknown): void {
  const reason = err instanceof CdnProviderError ? err.message : "unexpected error";
  console.error(`[cdn] ${active.adapter.id} purge failed: ${reason}`);
}

/**
 * Drop cached public pages at the site's CDN after a revalidation.
 * One site purges `https://<hostname>/*`. A full clear purges the whole zone.
 * No-op when no CDN is configured, so local installs stay unchanged. Failures
 * are logged, never thrown.
 */
export async function purgeCdnCache(opts?: {
  siteId?: string;
  hostname?: string;
  all?: boolean;
}): Promise<void> {
  const siteId = opts?.siteId && SITE_ID.test(opts.siteId) ? opts.siteId : undefined;
  const active = await loadActiveCdn(siteId);
  if (!active) return;

  const now = Date.now();
  if (opts?.all) {
    const cooldownKey = `*:${active.source}:${siteId?.toLowerCase() ?? ""}`;
    if (now - (lastPurgeAt.get(cooldownKey) ?? 0) < COOLDOWN_MS) return;
    lastPurgeAt.set(cooldownKey, now);
    try {
      await active.adapter.purgeAll(active.config);
    } catch (err) {
      logFailure(active, err);
    }
    return;
  }

  const urls = await sitePurgeUrls(siteId, opts?.hostname);
  if (urls.length === 0) return;

  const cooldownKey = siteId?.toLowerCase() ?? urls.join("|");
  if (now - (lastPurgeAt.get(cooldownKey) ?? 0) < COOLDOWN_MS) return;
  lastPurgeAt.set(cooldownKey, now);

  try {
    await active.adapter.purgeUrls(active.config, urls);
  } catch (err) {
    logFailure(active, err);
  }
}
