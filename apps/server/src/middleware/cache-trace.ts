import type { NextFunction, Response } from "express";
import {
  formatCacheSummary,
  getRequestCacheEvents,
  pageCacheStatus,
  runWithCacheTrace,
  type CacheTraceRequest,
} from "../lib/cache-trace.js";

/**
 * Per-request cache tracing + response headers:
 *   X-Jf-Cache: hits=2; misses=1; sets=1
 *   X-Jf-Page-Cache: HIT | MISS | BYPASS
 */
export function cacheTraceMiddleware(req: CacheTraceRequest, res: Response, next: NextFunction): void {
  runWithCacheTrace(req, () => {
    const originalEnd = res.end.bind(res);
    res.end = function (...args: Parameters<Response["end"]>) {
      const events = getRequestCacheEvents(req);
      if (!res.headersSent) {
        if (events.length > 0) {
          res.setHeader("X-Jf-Cache", formatCacheSummary(events));
        }
        const page = (res.locals.jfPageCache as string | undefined) ?? pageCacheStatus(events);
        if (page) res.setHeader("X-Jf-Page-Cache", page);
      }
      return originalEnd(...args);
    } as Response["end"];
    next();
  });
}
