import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { loadConfig, parseEnvBool } from "@justflows/core";
import { createJfCache, type JfCache } from "@justflows/cache";
import { getJfRoot } from "./jf-root.js";
import { logCacheEventIfDebug, recordCacheEvent } from "./cache-trace.js";
import { resolvePathUnderBase } from "./safe-path.js";

let instance: JfCache | null = null;
let instanceEnabled: boolean | null = null;

export function cacheStorageDir(): string {
  const raw = (process.env.CACHE_DIR ?? ".cache").trim() || ".cache";
  const root = getJfRoot();
  const resolved = path.isAbsolute(raw)
    ? resolvePathUnderBase(root, path.relative(root, raw))
    : resolvePathUnderBase(root, raw);
  return resolved ?? path.join(root, ".cache");
}

/** Delete every on-disk cache file. Safe no-op if the directory is missing. */
export async function wipeCacheStorage(): Promise<void> {
  await fsp.rm(cacheStorageDir(), { recursive: true, force: true }).catch(() => undefined);
}

function wipeCacheStorageSync(): void {
  try {
    fs.rmSync(cacheStorageDir(), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function resolveCacheOptions() {
  try {
    const config = loadConfig();
    return {
      enabled: config.cache.enabled,
      driver: config.cache.driver,
      ttlSeconds: config.cache.ttlSeconds,
      dir: config.cache.dir ?? cacheStorageDir(),
      redisUrl: config.cache.redisUrl,
    };
  } catch {
    // Pre-install or incomplete .env — read CACHE_* from process.env directly.
    const driver: "memory" | "filesystem" =
      process.env.CACHE_DRIVER === "memory" ? "memory" : "filesystem";
    const ttl = parseInt(process.env.CACHE_TTL_SECONDS ?? "300", 10);
    return {
      // Unset (install wizard, missing key) is off — never start writing
      // `.cache` files before the owner opts in.
      enabled: parseEnvBool(process.env.CACHE_ENABLED, false),
      driver,
      ttlSeconds: Number.isFinite(ttl) ? ttl : 300,
      dir: process.env.CACHE_DIR ?? cacheStorageDir(),
      redisUrl: process.env.CACHE_REDIS_URL,
    };
  }
}

function attachObserver(cache: JfCache): JfCache {
  cache.setObserver((event) => {
    recordCacheEvent(event);
    logCacheEventIfDebug(event);
  });
  return cache;
}

/** Shared Justflows cache (jf-cache). Configure via CACHE_ENABLED, CACHE_DRIVER, etc. */
export function getJfCache(): JfCache {
  const opts = resolveCacheOptions();
  // The singleton is often created on the first request (security headers),
  // which on a fresh install is before `.env` exists. Recreate when the
  // enabled flag changes so CACHE_ENABLED=0 actually takes effect.
  if (!instance || instanceEnabled !== opts.enabled) {
    instance = attachObserver(createJfCache(opts));
    instanceEnabled = opts.enabled;
    if (!opts.enabled) wipeCacheStorageSync();
  }
  return instance;
}

/** Drop the singleton so the next getJfCache() picks up fresh config. */
export function resetJfCache(): void {
  instance = null;
  instanceEnabled = null;
}

/** @deprecated Use resetJfCache */
export function resetJfCacheForTests(): void {
  resetJfCache();
}
