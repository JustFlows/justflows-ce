import type { NextFunction, Request, Response } from "express";
import { getPerformanceConfig } from "../lib/performance-settings.js";

const NO_BROWSER_CACHE = /^\/(admin|api|install|login)(\/|$)/;

const STATIC_PATHS = /^\/(uploads|assets|css-providers|public)(\/|$)/;

function cacheControlForPath(pathname: string): string | null {
  const config = getPerformanceConfig().browserCache;
  if (!config.enabled) return null;

  if (NO_BROWSER_CACHE.test(pathname)) {
    return "no-store";
  }

  if (pathname === "/theme.css") {
    return `public, max-age=${config.htmlMaxAge}, stale-while-revalidate=${config.staleWhileRevalidate}`;
  }

  if (STATIC_PATHS.test(pathname)) {
    return `public, max-age=${config.staticMaxAge}, immutable`;
  }

  if (pathname === "/robots.txt") {
    return `public, max-age=${config.htmlMaxAge}`;
  }

  // Public HTML pages (everything else that isn't an API path)
  if (!pathname.includes(".")) {
    return `public, max-age=${config.htmlMaxAge}, stale-while-revalidate=${config.staleWhileRevalidate}`;
  }

  return null;
}

/** Set Cache-Control early — must not patch res.end (breaks GZIP compression). */
export function browserCacheMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET") {
    const value = cacheControlForPath(req.path);
    if (value) res.setHeader("Cache-Control", value);
  }
  next();
}

export function staticMaxAgeMs(): number {
  const seconds = getPerformanceConfig().browserCache.staticMaxAge;
  return getPerformanceConfig().browserCache.enabled ? seconds * 1000 : 0;
}
