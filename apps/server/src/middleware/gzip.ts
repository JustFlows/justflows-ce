import compression from "compression";
import type { Request, Response } from "express";
import { getPerformanceConfig } from "../lib/performance-settings.js";

const COMPRESSIBLE = /^\s*(?:text\/|application\/(?:json|javascript|xml|wasm|svg\+xml|ld\+json)|image\/svg\+xml)/i;

function shouldCompress(req: Request, res: Response): boolean {
  if (!getPerformanceConfig().gzip.enabled) return false;
  if (req.headers["x-no-compression"]) return false;

  const type = res.getHeader("Content-Type");
  if (typeof type === "string" && !COMPRESSIBLE.test(type)) return false;

  return compression.filter(req, res);
}

/** GZIP (and deflate) compression for text/json responses. */
export function createGzipMiddleware() {
  const { level, minBytes } = getPerformanceConfig().gzip;
  return compression({
    filter: shouldCompress,
    level,
    threshold: minBytes,
  });
}
