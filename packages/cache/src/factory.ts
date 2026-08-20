import type { CacheAdapter } from "./adapter.js";
import { MemoryCache } from "./memory.js";
import { FilesystemCache } from "./filesystem.js";
import { NullCache } from "./null.js";
import { JfCache } from "./jf-cache.js";

export interface CacheOptions {
  driver: "memory" | "filesystem" | "redis";
  ttlSeconds?: number;
  /** When false, reads always miss and writes are no-ops. Default: true. */
  enabled?: boolean;
  /** Required for filesystem driver */
  dir?: string;
  /** Required for redis driver */
  redisUrl?: string;
}

export function createCache(opts: CacheOptions): CacheAdapter {
  if (opts.enabled === false) return new NullCache();

  switch (opts.driver) {
    case "memory":
      return new MemoryCache(opts.ttlSeconds ?? 300);

    case "filesystem":
      return new FilesystemCache(opts.dir ?? "./.cache", opts.ttlSeconds ?? 300);

    case "redis":
      // Redis is optional — only available if the redis package is installed.
      // We load it lazily so basic installs don't need redis as a dependency.
      throw new Error(
        "Redis cache adapter: install the 'redis' package and use RedisCache directly. " +
        "Redis is never required for basic Justflows installations.",
      );

    default:
      throw new Error(`Unknown cache driver: ${(opts as CacheOptions).driver}`);
  }
}

/** Create a JfCache instance (remember/get/invalidate) from options. */
export function createJfCache(opts: CacheOptions): JfCache {
  const enabled = opts.enabled !== false;
  const adapter = createCache(opts);
  return new JfCache(adapter, enabled);
}
