// SPDX-License-Identifier: MIT

/**
 * Cache stores: a plugin can back the shared jf-cache with an external
 * service, so several application processes share cache entries and
 * invalidations. Available from SDK 0.1.9. See `docs/CACHE.md`.
 */

const SCOPED_KEY = /^s:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(.*)$/i;

/**
 * True when `key` is removed by `invalidate(prefix)`. A site-scoped prefix
 * (`s:<siteId>:page:html:`) matches only that site. A logical prefix
 * (`page:html:`) also matches the same tail inside every site
 * (`s:<siteId>:page:html:…`). A cache store's `invalidate` must follow this.
 */
export function cacheKeyMatchesPrefix(key: string, prefix: string): boolean {
  if (key.startsWith(prefix)) return true;
  const match = SCOPED_KEY.exec(key);
  if (!match) return false;
  if (SCOPED_KEY.test(prefix)) return false;
  return match[2]!.startsWith(prefix);
}

/** True for a prefix that already names one site (`s:<siteId>:…`). */
export function isSiteScopedCacheKey(key: string): boolean {
  return SCOPED_KEY.test(key);
}

/**
 * Where a store stands, shown in Admin → Tools and Site Health.
 * `ready`: serving. `connecting`: starting or reconnecting.
 * `unavailable`: cannot serve; the host bypasses the cache meanwhile.
 */
export interface CacheStoreStatus {
  state: "ready" | "connecting" | "unavailable";
  /** Short operator-facing reason. Never include credentials. */
  detail?: string;
}

/**
 * A running cache store. Keys and values come from the host: keys are
 * strings, values are JSON-serializable. A failing call should reject; the
 * host turns a failed read into a miss and a failed write into a skip, and
 * after a failed `delete`, `invalidate`, or `clear` it bypasses the store
 * until a full `clear()` succeeds, so no process serves an entry whose
 * invalidation was lost.
 */
export interface CacheStore {
  get(key: string): Promise<unknown>;
  /** `ttlSeconds` of 0 or less means no expiry. */
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Remove every key `cacheKeyMatchesPrefix(key, prefix)` accepts. */
  invalidate(prefix: string): Promise<void>;
  /** Remove every key this store holds for the installation, nothing else. */
  clear(): Promise<void>;
  has(key: string): Promise<boolean>;
  status(): CacheStoreStatus;
  /** Key count and a few sample keys for Admin → Tools. Optional and may be approximate. */
  stats?(): Promise<{ keyCount: number; sampleKeys: string[] }>;
  /** Release connections. Called when the store is deselected or its plugin deactivates. */
  close?(): Promise<void>;
}

/** What `ctx.cache.registerStore` takes. */
export interface CacheStoreDefinition {
  /** Lowercase kebab-case, unique within the plugin. */
  id: string;
  /** Shown in the Admin → Tools cache driver list. */
  label: string;
  /**
   * Build the store. The host calls this only when the operator selected it
   * as the cache driver, so an unselected store opens no connections. Throw
   * when it cannot be configured; the host then bypasses the cache and shows
   * the message.
   */
  create(options: { defaultTtlSeconds: number }): CacheStore;
}
