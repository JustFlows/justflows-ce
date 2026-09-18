import { AsyncLocalStorage } from "node:async_hooks";
import type { Request } from "express";
import type { CacheEvent } from "@justflows/cache";

export interface CacheTraceRequest extends Request {
  jfCacheEvents?: CacheEvent[];
}

const requestStorage = new AsyncLocalStorage<CacheTraceRequest>();

export function runWithCacheTrace<T>(req: CacheTraceRequest, fn: () => T): T {
  req.jfCacheEvents = [];
  return requestStorage.run(req, fn);
}

export function recordCacheEvent(event: CacheEvent): void {
  requestStorage.getStore()?.jfCacheEvents?.push(event);
}

export function getRequestCacheEvents(req?: CacheTraceRequest): CacheEvent[] {
  return req?.jfCacheEvents ?? requestStorage.getStore()?.jfCacheEvents ?? [];
}

export function formatCacheSummary(events: CacheEvent[]): string {
  const hits = events.filter((e) => e.type === "hit").length;
  const misses = events.filter((e) => e.type === "miss").length;
  const sets = events.filter((e) => e.type === "set").length;
  return `hits=${hits}; misses=${misses}; sets=${sets}`;
}

export function pageCacheStatus(events: CacheEvent[]): "HIT" | "MISS" | null {
  const pageEvents = events.filter((e) => e.key.startsWith("page:html:"));
  if (pageEvents.length === 0) return null;
  return pageEvents.some((e) => e.type === "hit") ? "HIT" : "MISS";
}

export function logCacheEventIfDebug(event: CacheEvent): void {
  if (process.env.LOG_LEVEL !== "debug") return;
  const ttl = event.ttlSeconds !== undefined ? ` ttl=${event.ttlSeconds}s` : "";
  console.debug(`[jf-cache] ${event.type.toUpperCase()} ${event.key}${ttl}`);
}
