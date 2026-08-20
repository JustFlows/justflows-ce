export interface CacheAdapter {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Delete all keys matching the prefix */
  invalidate(prefix: string): Promise<void>;
  clear(): Promise<void>;
  has(key: string): Promise<boolean>;
}
