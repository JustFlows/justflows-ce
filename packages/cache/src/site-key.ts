// SPDX-License-Identifier: MIT

const SITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPED = /^s:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(.*)$/i;

/** Directory name for a key written as `s:<siteId>:…`. Unscoped keys stay in the cache root. */
export function siteShard(key: string): string | null {
  const match = SCOPED.exec(key);
  return match ? match[1]!.toLowerCase() : null;
}

export function isSiteShardName(name: string): boolean {
  return SITE_ID.test(name);
}

/**
 * A site-scoped prefix (`s:<siteId>:page:html:`) matches only that site.
 * A logical prefix (`page:html:`) also matches the same tail inside every site.
 */
export function cacheKeyMatchesPrefix(key: string, prefix: string): boolean {
  if (key.startsWith(prefix)) return true;
  const match = SCOPED.exec(key);
  if (!match) return false;
  const scopedPrefix = SCOPED.exec(prefix);
  if (scopedPrefix) return false;
  return match[2]!.startsWith(prefix);
}
