import type { CacheAdapter } from "./adapter.js";
import { cacheKeyMatchesPrefix } from "./site-key.js";
import type { CacheEvent, CacheObserver, CacheStatsSnapshot } from "./types.js";

/**
 * Justflows cache facade — similar to Next.js data cache: `remember()` deduplicates
 * concurrent fetches and stores results with a TTL when caching is enabled.
 */
export class JfCache {
  private readonly inflight = new Map<string, Promise<unknown>>();
  private observer: CacheObserver | null = null;
  private readonly stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    invalidations: 0,
    clears: 0,
  };

  private scopeKey: (key: string) => string = (key) => key;

  constructor(
    private readonly adapter: CacheAdapter,
    readonly enabled: boolean,
  ) {}

  /** Prefix keys with the current site before they reach the adapter. */
  setKeyScope(scope: ((key: string) => string) | null): void {
    this.scopeKey = scope ?? ((key) => key);
  }

  private k(key: string): string {
    return this.scopeKey(key);
  }

  setObserver(observer: CacheObserver | null): void {
    this.observer = observer;
  }

  getStats(): CacheStatsSnapshot {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.sets = 0;
    this.stats.deletes = 0;
    this.stats.invalidations = 0;
    this.stats.clears = 0;
  }

  private emit(event: CacheEvent): void {
    switch (event.type) {
      case "hit":
        this.stats.hits++;
        break;
      case "miss":
        this.stats.misses++;
        break;
      case "set":
        this.stats.sets++;
        break;
      case "delete":
        this.stats.deletes++;
        break;
      case "invalidate":
        this.stats.invalidations++;
        break;
      case "clear":
        this.stats.clears++;
        break;
    }
    this.observer?.(event);
  }

  /** Read-through cache with in-flight deduplication (like Next.js `unstable_cache`). */
  async remember<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const scoped = this.k(key);
    if (this.enabled) {
      const cached = await this.adapter.get<T>(scoped);
      if (cached !== undefined) {
        this.emit({ type: "hit", key: scoped });
        return cached;
      }
      this.emit({ type: "miss", key: scoped, ttlSeconds });
    }

    const pending = this.inflight.get(scoped);
    if (pending) return pending as Promise<T>;

    const promise = fn()
      .then(async (value) => {
        if (this.enabled) {
          await this.adapter.set(scoped, value, ttlSeconds);
          this.emit(
            ttlSeconds !== undefined
              ? { type: "set", key: scoped, ttlSeconds }
              : { type: "set", key: scoped },
          );
        }
        return value;
      })
      .finally(() => {
        this.inflight.delete(scoped);
      });

    this.inflight.set(scoped, promise);
    return promise;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    if (!this.enabled) return undefined;
    const scoped = this.k(key);
    const value = await this.adapter.get<T>(scoped);
    if (value !== undefined) this.emit({ type: "hit", key: scoped });
    return value;
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (!this.enabled) return;
    const scoped = this.k(key);
    await this.adapter.set(scoped, value, ttlSeconds);
    this.emit(
      ttlSeconds !== undefined ? { type: "set", key: scoped, ttlSeconds } : { type: "set", key: scoped },
    );
  }

  async delete(key: string): Promise<void> {
    const scoped = this.k(key);
    this.inflight.delete(scoped);
    if (!this.enabled) return;
    await this.adapter.delete(scoped);
    this.emit({ type: "delete", key: scoped });
  }

  async invalidate(prefix: string): Promise<void> {
    const scoped = this.k(prefix);
    for (const key of this.inflight.keys()) {
      if (cacheKeyMatchesPrefix(key, scoped)) this.inflight.delete(key);
    }
    if (!this.enabled) return;
    await this.adapter.invalidate(scoped);
    this.emit({ type: "invalidate", key: scoped });
  }

  async clear(): Promise<void> {
    this.inflight.clear();
    if (!this.enabled) return;
    await this.adapter.clear();
    this.emit({ type: "clear", key: "*" });
  }
}
