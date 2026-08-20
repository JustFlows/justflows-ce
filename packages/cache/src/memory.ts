import type { CacheAdapter } from "./adapter.js";

interface Entry<T> {
  value: T;
  expiresAt: number | null;
}

export class MemoryCache implements CacheAdapter {
  private readonly store = new Map<string, Entry<unknown>>();
  private readonly defaultTtl: number;

  constructor(defaultTtlSeconds = 300) {
    this.defaultTtl = defaultTtlSeconds;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key) as Entry<T> | undefined;
    if (!entry) return undefined;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? this.defaultTtl;
    this.store.set(key, {
      value,
      expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : null,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async invalidate(prefix: string): Promise<void> {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  /** Remove expired entries (call periodically to reclaim memory). */
  purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}
