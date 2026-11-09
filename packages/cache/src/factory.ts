import type { CacheAdapter } from "./adapter.js";
import { MemoryCache } from "./memory.js";
import { FilesystemCache } from "./filesystem.js";
import { NullCache } from "./null.js";
import { JfCache } from "./jf-cache.js";

export interface CacheOptions {
  /** Built-in backend. Ignored when `adapter` is given. */
  driver?: "memory" | "filesystem";
  ttlSeconds?: number;
  /** When false, reads always miss and writes are no-ops. Default: true. */
  enabled?: boolean;
  /** Required for filesystem driver */
  dir?: string;
  /**
   * A backend supplied by the caller, such as a store an extension provides
   * (see `DelegatingCache` and `GuardedCache`). Wins over `driver`.
   */
  adapter?: CacheAdapter;
}

export function createCache(opts: CacheOptions): CacheAdapter {
  if (opts.enabled === false) return new NullCache();
  if (opts.adapter) return opts.adapter;

  const driver = opts.driver ?? "filesystem";
  switch (driver) {
    case "memory":
      return new MemoryCache(opts.ttlSeconds ?? 300);

    case "filesystem":
      return new FilesystemCache(opts.dir ?? "./.cache", opts.ttlSeconds ?? 300);

    default:
      throw new Error(`Unknown cache driver: ${String(driver)}`);
  }
}

/** Create a JfCache instance (remember/get/invalidate) from options. */
export function createJfCache(opts: CacheOptions): JfCache {
  const enabled = opts.enabled !== false;
  const adapter = createCache(opts);
  return new JfCache(adapter, enabled);
}
