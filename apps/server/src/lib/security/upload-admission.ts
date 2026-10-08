// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from "express";
import { getTenantContext } from "../tenancy/context.js";

/**
 * Admission control for multipart uploads, applied before multer buffers the
 * body in memory.
 *
 * Request-count rate limits do not bound memory: a handful of concurrent
 * 100 MB uploads is within any per-minute limit and still exhausts a shared
 * process. Each upload class gets a ceiling on uploads in flight per site and
 * for the whole process, and a declared body larger than the class allows is
 * refused before a byte is read.
 *
 * Counters are per process. Several workers multiply them, so deployments
 * behind a load balancer should also cap request bodies at the proxy.
 */

export interface UploadAdmissionOptions {
  /** Distinguishes upload classes, so media and extension uploads do not share a budget. */
  name: string;
  /** Largest file the route accepts; the declared body may add multipart overhead. */
  maxBytes: number;
  perSite: number;
  global: number;
}

const MULTIPART_OVERHEAD = 1024 * 1024;
const inFlight = new Map<string, number>();

function envLimit(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

function siteKey(req: Request): string {
  return (
    req.session?.siteId ??
    (req as { apiKeyOwner?: { siteId?: string } }).apiKeyOwner?.siteId ??
    getTenantContext()?.siteId ??
    "installation"
  );
}

function take(key: string): void {
  inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
}

function give(key: string): void {
  const next = (inFlight.get(key) ?? 1) - 1;
  if (next <= 0) inFlight.delete(key);
  else inFlight.set(key, next);
}

export function admitUpload(options: UploadAdmissionOptions) {
  const globalLimit = envLimit("JF_UPLOAD_CONCURRENCY", options.global);
  return (req: Request, res: Response, next: NextFunction): void => {
    const declared = Number(req.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > options.maxBytes + MULTIPART_OVERHEAD) {
      res.status(413).json({ error: `File is too large (limit ${Math.round(options.maxBytes / 1024 / 1024)} MB).` });
      return;
    }
    const globalKey = `${options.name}:*`;
    const perSiteKey = `${options.name}:${siteKey(req)}`;
    if ((inFlight.get(globalKey) ?? 0) >= globalLimit) {
      res.status(503).set("Retry-After", "10").json({ error: "The server is busy with other uploads. Try again shortly." });
      return;
    }
    if ((inFlight.get(perSiteKey) ?? 0) >= options.perSite) {
      res.status(429).set("Retry-After", "10").json({ error: "Too many uploads in progress. Wait for one to finish." });
      return;
    }
    take(globalKey);
    take(perSiteKey);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      give(globalKey);
      give(perSiteKey);
    };
    res.once("finish", release);
    res.once("close", release);
    // Count what actually arrives: a chunked request has no Content-Length to
    // check up front. Multer pipes the request in the same tick, so this
    // listener sees the same bytes without taking any from it.
    const budget = options.maxBytes + MULTIPART_OVERHEAD;
    let received = 0;
    const count = (chunk: Buffer) => {
      received += chunk.length;
      if (received <= budget) return;
      req.off("data", count);
      req.unpipe();
      if (!res.headersSent) {
        res.status(413).set("Connection", "close").json({ error: `File is too large (limit ${Math.round(options.maxBytes / 1024 / 1024)} MB).` });
      }
      req.destroy();
    };
    req.on("data", count);
    next();
  };
}

/** Run `fn` with at most `limit` concurrent callers; the rest wait their turn. */
export function createSemaphore(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    // A finishing caller hands its slot straight to the next waiter, so a
    // newcomer can never slip in between and exceed the limit.
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else active += 1;
    try {
      return await fn();
    } finally {
      const nextWaiter = waiting.shift();
      if (nextWaiter) nextWaiter();
      else active -= 1;
    }
  };
}

/** Run `fn` exclusively per key (in this process), in arrival order. */
export function createKeyedLock() {
  const tails = new Map<string, Promise<unknown>>();
  return async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(fn);
    const tail = current.catch(() => undefined);
    tails.set(key, tail);
    try {
      return await current;
    } finally {
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}

/** Extension packages and imports: at most 50 MB, one per site at a time. */
export const PACKAGE_UPLOAD_BYTES = 50 * 1024 * 1024;

export function admitPackageUpload(name: string) {
  return admitUpload({ name, maxBytes: PACKAGE_UPLOAD_BYTES, perSite: 1, global: 4 });
}

/**
 * Multer limits for routes that accept a file and, at most, a few small text
 * fields. Multer's defaults allow unlimited fields of up to 1 MB each, all
 * buffered in memory, which a file-size limit does nothing about.
 */
export function multipartLimits(fileSize: number, files = 1) {
  return {
    fileSize,
    files,
    fields: 10,
    fieldSize: 16 * 1024,
    fieldNameSize: 100,
    parts: files + 10,
    headerPairs: 100,
  };
}

/** Wrap a multer middleware so its limit errors become 413/400 answers instead of 500s. */
export function withMultipartErrors(
  middleware: (req: Request, res: Response, next: (err?: unknown) => void) => void,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    middleware(req, res, (err?: unknown) => {
      // The byte budget already answered and dropped the connection.
      if (res.headersSent) return;
      if (err && typeof err === "object" && (err as { name?: string }).name === "MulterError") {
        const code = (err as { code?: string }).code ?? "";
        res
          .status(code === "LIMIT_FILE_SIZE" ? 413 : 400)
          .json({ error: code === "LIMIT_FILE_SIZE" ? "File is too large." : "The upload has unexpected or too many fields." });
        return;
      }
      next(err as Error | undefined);
    });
  };
}
