// SPDX-License-Identifier: MIT

import type { CacheAdapter } from "./adapter.js";
import { NullCache } from "./null.js";

/**
 * An adapter whose backend is set later, for a store that becomes available
 * after the cache is created (for example one an extension registers once it
 * activates). Until `use()` gets an adapter every read misses and every write
 * is skipped, the same as a disabled cache.
 */
export class DelegatingCache implements CacheAdapter {
  private static readonly bypass = new NullCache();
  private target: CacheAdapter = DelegatingCache.bypass;

  /** Route calls to `adapter`, or back to bypass with `null`. */
  use(adapter: CacheAdapter | null): void {
    this.target = adapter ?? DelegatingCache.bypass;
  }

  /** True while no backend is attached. */
  get bypassing(): boolean {
    return this.target === DelegatingCache.bypass;
  }

  get<T = unknown>(key: string): Promise<T | undefined> {
    return this.target.get<T>(key);
  }

  set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    return this.target.set(key, value, ttlSeconds);
  }

  delete(key: string): Promise<void> {
    return this.target.delete(key);
  }

  invalidate(prefix: string): Promise<void> {
    return this.target.invalidate(prefix);
  }

  clear(): Promise<void> {
    return this.target.clear();
  }

  has(key: string): Promise<boolean> {
    return this.target.has(key);
  }
}
