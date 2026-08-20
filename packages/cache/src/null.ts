import type { CacheAdapter } from "./adapter.js";

/** Passthrough adapter — every read misses; writes are no-ops. Used when caching is disabled. */
export class NullCache implements CacheAdapter {
  async get<T = unknown>(_key: string): Promise<T | undefined> {
    return undefined;
  }

  async set<T = unknown>(_key: string, _value: T, _ttlSeconds?: number): Promise<void> {
    // no-op
  }

  async delete(_key: string): Promise<void> {
    // no-op
  }

  async invalidate(_prefix: string): Promise<void> {
    // no-op
  }

  async clear(): Promise<void> {
    // no-op
  }

  async has(_key: string): Promise<boolean> {
    return false;
  }
}
