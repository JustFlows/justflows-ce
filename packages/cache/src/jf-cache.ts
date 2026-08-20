import type { CacheAdapter } from "./adapter.js";
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

  constructor(
    private readonly adapter: CacheAdapter,
    readonly enabled: boolean,
  ) {}

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
    if (this.enabled) {
      const cached = await this.adapter.get<T>(key);
      if (cached !== undefined) {
        this.emit({ type: "hit", key });
        return cached;
      }
      this.emit({ type: "miss", key, ttlSeconds });
    }

    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = fn()
      .then(async (value) => {
        if (this.enabled) {
          await this.adapter.set(key, value, ttlSeconds);
          this.emit(
            ttlSeconds !== undefined
              ? { type: "set", key, ttlSeconds }
              : { type: "set", key },
          );
        }
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return promise;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    if (!this.enabled) return undefined;
    const value = await this.adapter.get<T>(key);
    if (value !== undefined) this.emit({ type: "hit", key });
    return value;
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (!this.enabled) return;
    await this.adapter.set(key, value, ttlSeconds);
    this.emit(
      ttlSeconds !== undefined ? { type: "set", key, ttlSeconds } : { type: "set", key },
    );
  }

  async delete(key: string): Promise<void> {
    this.inflight.delete(key);
    if (!this.enabled) return;
    await this.adapter.delete(key);
    this.emit({ type: "delete", key });
  }

  async invalidate(prefix: string): Promise<void> {
    for (const key of this.inflight.keys()) {
      if (key.startsWith(prefix)) this.inflight.delete(key);
    }
    if (!this.enabled) return;
    await this.adapter.invalidate(prefix);
    this.emit({ type: "invalidate", key: prefix });
  }

  async clear(): Promise<void> {
    this.inflight.clear();
    if (!this.enabled) return;
    await this.adapter.clear();
    this.emit({ type: "clear", key: "*" });
  }
}
