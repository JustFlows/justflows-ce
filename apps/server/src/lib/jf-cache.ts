import path from "node:path";
import { loadConfig, parseEnvBool } from "@justflows/core";
import { createJfCache, type JfCache } from "@justflows/cache";
import { getJfRoot } from "./jf-root.js";
import { logCacheEventIfDebug, recordCacheEvent } from "./cache-trace.js";

let instance: JfCache | null = null;

function resolveCacheOptions() {
  try {
    const config = loadConfig();
    return {
      enabled: config.cache.enabled,
      driver: config.cache.driver,
      ttlSeconds: config.cache.ttlSeconds,
      dir: config.cache.dir ?? path.join(getJfRoot(), ".cache"),
      redisUrl: config.cache.redisUrl,
    };
  } catch {
    // Pre-install or incomplete .env — read CACHE_* from process.env directly.
    const driver: "memory" | "filesystem" =
      process.env.CACHE_DRIVER === "memory" ? "memory" : "filesystem";
    const ttl = parseInt(process.env.CACHE_TTL_SECONDS ?? "300", 10);
    return {
      enabled: parseEnvBool(process.env.CACHE_ENABLED, true),
      driver,
      ttlSeconds: Number.isFinite(ttl) ? ttl : 300,
      dir: process.env.CACHE_DIR ?? path.join(getJfRoot(), ".cache"),
      redisUrl: process.env.CACHE_REDIS_URL,
    };
  }
}

/** Shared Justflows cache (jf-cache). Configure via CACHE_ENABLED, CACHE_DRIVER, etc. */
export function getJfCache(): JfCache {
  if (!instance) {
    instance = createJfCache(resolveCacheOptions());
    instance.setObserver((event) => {
      recordCacheEvent(event);
      logCacheEventIfDebug(event);
    });
  }
  return instance;
}

/** Drop the singleton so the next getJfCache() picks up fresh config. */
export function resetJfCache(): void {
  instance = null;
}

/** @deprecated Use resetJfCache */
export function resetJfCacheForTests(): void {
  resetJfCache();
}
