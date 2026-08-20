export type CacheEventType = "hit" | "miss" | "set" | "delete" | "invalidate" | "clear";

export interface CacheEvent {
  type: CacheEventType;
  key: string;
  ttlSeconds?: number;
}

export interface CacheStatsSnapshot {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  invalidations: number;
  clears: number;
}

export type CacheObserver = (event: CacheEvent) => void;
