// SPDX-License-Identifier: MIT

import { getTenantContext } from "../tenancy/context.js";

const SITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALREADY_SCOPED = /^s:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:/i;

/** Site id for a cache key. Falls back to the request's site. */
export function cacheSiteId(explicit?: string | null): string {
  const value = (explicit || getTenantContext()?.siteId || "").trim();
  return SITE_ID.test(value) ? value.toLowerCase() : "site";
}

/** `s:<siteId>:<key>` so the filesystem cache can store one directory per site. */
export function scopeCacheKeyTo(siteId: string | null | undefined, key: string): string {
  if (ALREADY_SCOPED.test(key)) return key;
  if (!siteId || !SITE_ID.test(siteId)) return key;
  return `s:${siteId.toLowerCase()}:${key}`;
}

/** Scope a key to the site handling the current request. */
export function scopeCacheKey(key: string): string {
  return scopeCacheKeyTo(getTenantContext()?.siteId, key);
}
