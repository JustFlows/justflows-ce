// SPDX-License-Identifier: MIT

import type { CacheStore, CacheStoreDefinition, CacheStoreStatus } from "@justflows/sdk";
import { DelegatingCache, GuardedCache, type CacheAdapter } from "@justflows/cache";
import { CACHE_STORE_DRIVER_RE } from "@justflows/core";
import { recordDiagnosticError } from "../runtime/diagnostics.js";

/**
 * Cache stores plugins offer through `ctx.cache.registerStore`. One of them
 * backs the shared jf-cache when `CACHE_DRIVER` names it
 * (`plugin:<pluginId>.<storeId>`). Until it is registered and built, and
 * whenever it is unavailable, the cache is bypassed: reads miss and writes
 * are skipped, never served from a stale local copy.
 */

const STORE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Report a failing store to Diagnostics at most this often per operation. */
const REPORT_INTERVAL_MS = 60_000;

interface Registration {
  key: string;
  owner: string;
  siteId: string;
  definition: CacheStoreDefinition;
}

interface ActiveStore {
  key: string;
  store: CacheStore;
  guard: GuardedCache;
}

const registrations = new Map<string, Registration>();
const delegating = new DelegatingCache();
let selected: { key: string; defaultTtlSeconds: number } | null = null;
let active: ActiveStore | null = null;
let failure: { key: string; detail: string } | null = null;
let queue: Promise<void> = Promise.resolve();
const lastReport = new Map<string, number>();

/** Decides whether a registering site is the installation's main site. Replaceable in tests. */
let mainSiteCheck: (siteId: string) => Promise<boolean> = async (siteId) => {
  const { installationRootSiteId } = await import("../tenancy/registry.js");
  const rootId = await installationRootSiteId().catch(() => null);
  if (rootId) return rootId === siteId;
  /** No tenancy tables: a single-site install is its own main site. */
  const { getSiteId } = await import("../settings/site-settings.js");
  return ((await getSiteId()) ?? siteId) === siteId;
};

export function isCacheStoreDriver(driver: string | undefined): driver is string {
  return typeof driver === "string" && CACHE_STORE_DRIVER_RE.test(driver);
}

/** The adapter the jf-cache uses while a plugin store is the driver. */
export function cacheStoreAdapter(): CacheAdapter {
  return delegating;
}

/** Register a plugin's store. Throws on a malformed or duplicate id. */
export function registerCacheStore(owner: string, siteId: string, definition: CacheStoreDefinition): void {
  if (!definition || typeof definition.create !== "function") {
    throw new Error("A cache store needs a create() function");
  }
  if (!STORE_ID_RE.test(definition.id)) throw new Error("Cache store id must be lowercase kebab-case");
  if (typeof definition.label !== "string" || !definition.label.trim() || definition.label.length > 80) {
    throw new Error("Cache store label must contain 1–80 characters");
  }
  const key = `plugin:${owner}.${definition.id}`;
  if (registrations.has(key)) throw new Error(`Cache store "${key}" is already registered`);
  registrations.set(key, { key, owner, siteId, definition });
  schedule();
}

/** Drop every store `owner` registered, closing the one in use. */
export function unregisterCacheStores(owner: string): void {
  let removed = false;
  for (const [key, registration] of registrations) {
    if (registration.owner !== owner) continue;
    registrations.delete(key);
    removed = true;
  }
  if (removed) schedule();
}

/**
 * Tell the registry which driver the jf-cache uses. Called whenever the
 * cache singleton is (re)built. `null` for a built-in driver.
 */
export function selectCacheStore(driver: string | null, defaultTtlSeconds: number): void {
  const next = driver && isCacheStoreDriver(driver) ? { key: driver, defaultTtlSeconds } : null;
  if (next?.key === selected?.key && next?.defaultTtlSeconds === selected?.defaultTtlSeconds) return;
  selected = next;
  schedule();
}

/** Registered stores for the Admin → Tools driver list. */
export function listCacheStores(): Array<{ id: string; label: string }> {
  return [...registrations.values()].map(({ key, definition }) => ({ id: key, label: definition.label }));
}

/** Status of the selected plugin store, or null when a built-in driver is in use. */
export function selectedCacheStoreStatus(): (CacheStoreStatus & { id: string; label: string | null }) | null {
  if (!selected) return null;
  const registration = registrations.get(selected.key);
  const label = registration?.definition.label ?? null;
  const base = { id: selected.key, label };
  if (!registration) {
    return { ...base, state: "unavailable", detail: "No active plugin provides this cache store." };
  }
  if (failure?.key === selected.key) return { ...base, state: "unavailable", detail: failure.detail };
  if (!active || active.key !== selected.key) return { ...base, state: "connecting" };
  if (active.guard.degraded) {
    return {
      ...base,
      state: "unavailable",
      detail: "An invalidation could not be delivered. The cache is bypassed until the store can be cleared.",
    };
  }
  try {
    const status = active.store.status();
    return { ...base, state: status.state, ...(status.detail ? { detail: String(status.detail).slice(0, 300) } : {}) };
  } catch (error) {
    return { ...base, state: "unavailable", detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Key count and samples from the selected store, or null when a built-in driver is in use. */
export async function inspectSelectedCacheStore(): Promise<{
  keyCount: number;
  totalBytes: number;
  sampleKeys: string[];
} | null> {
  if (!selected) return null;
  const current = active?.key === selected.key ? active : null;
  if (!current?.store.stats) return { keyCount: 0, totalBytes: 0, sampleKeys: [] };
  try {
    const stats = await current.store.stats();
    return {
      keyCount: Number.isFinite(stats.keyCount) ? stats.keyCount : 0,
      totalBytes: 0,
      sampleKeys: Array.isArray(stats.sampleKeys) ? stats.sampleKeys.slice(0, 20).map(String) : [],
    };
  } catch {
    return { keyCount: 0, totalBytes: 0, sampleKeys: [] };
  }
}

/** Wait until pending attach/detach work is done. For tests and shutdown. */
export function settleCacheStores(): Promise<void> {
  return queue;
}

/** Reset all state. Tests only. */
export async function resetCacheStoresForTests(check?: (siteId: string) => Promise<boolean>): Promise<void> {
  await queue;
  registrations.clear();
  selected = null;
  failure = null;
  await detach();
  lastReport.clear();
  if (check) mainSiteCheck = check;
}

function schedule(): void {
  queue = queue.then(reconcile, reconcile);
}

/** Attach the selected store when it is registered, or detach the current one. */
async function reconcile(): Promise<void> {
  const registration = selected ? registrations.get(selected.key) : undefined;
  if (active && (!registration || active.key !== registration.key)) await detach();
  if (failure && failure.key !== selected?.key) failure = null;
  if (!registration || !selected || active) return;

  const ttl = selected.defaultTtlSeconds;
  if (!(await mainSiteCheck(registration.siteId).catch(() => false))) {
    failure = {
      key: registration.key,
      detail: "A cache store is used only while its plugin is active on the main site.",
    };
    return;
  }

  let store: CacheStore;
  try {
    store = registration.definition.create({ defaultTtlSeconds: ttl });
  } catch (error) {
    failure = { key: registration.key, detail: error instanceof Error ? error.message : String(error) };
    recordDiagnosticError(`plugin:${registration.owner} cache store ${registration.definition.id}`, error);
    return;
  }

  /** The selection or registration may have changed while this ran. */
  if (selected?.key !== registration.key || registrations.get(registration.key) !== registration) {
    await store.close?.().catch(() => undefined);
    return;
  }

  failure = null;
  const guard = new GuardedCache(bridge(store, ttl), {
    onError: (operation, error) => report(registration, operation, error),
  });
  active = { key: registration.key, store, guard };
  delegating.use(guard);
}

async function detach(): Promise<void> {
  const current = active;
  active = null;
  delegating.use(null);
  if (!current) return;
  try {
    await current.store.close?.();
  } catch {
    /** A store that fails to close is already out of use. */
  }
}

function bridge(store: CacheStore, defaultTtlSeconds: number): CacheAdapter {
  return {
    get: async <T>(key: string) => {
      const value = await store.get(key);
      return value === undefined ? undefined : (value as T);
    },
    set: (key, value, ttlSeconds) => store.set(key, value, ttlSeconds ?? defaultTtlSeconds),
    delete: (key) => store.delete(key),
    invalidate: (prefix) => store.invalidate(prefix),
    clear: () => store.clear(),
    has: (key) => store.has(key),
  };
}

function report(registration: Registration, operation: string, error: unknown): void {
  const id = `${registration.key}:${operation}`;
  const now = Date.now();
  if (now - (lastReport.get(id) ?? 0) < REPORT_INTERVAL_MS) return;
  lastReport.set(id, now);
  recordDiagnosticError(`plugin:${registration.owner} cache store ${operation}`, error);
}
