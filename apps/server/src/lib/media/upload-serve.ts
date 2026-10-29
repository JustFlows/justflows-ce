// SPDX-License-Identifier: MIT

import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { encodeKeyPath } from "@justflows/media";
import { uploadsDir } from "../runtime/jf-root.js";
import { resolvePathUnderBase } from "../security/safe-path.js";
import { STATIC_EXPORT_HEADER } from "../static-export/config.js";
import { parseByteRange } from "../files/private-storage.js";
import {
  getUploadStore,
  isS3UploadStore,
  isSafeUploadKey,
  type S3UploadStore,
} from "./upload-store.js";
import { PRIVATE_UPLOADS_FOLDER } from "../files/private-storage.js";
import { trashedUploadKeyCandidates } from "./upload-paths.js";

/** Request headers forwarded to S3 so range and conditional requests work. */
const PASSTHROUGH = [
  "range",
  "if-none-match",
  "if-modified-since",
  "if-match",
  "if-unmodified-since",
];
/** Response headers relayed from S3. */
const RELAY = [
  "content-type",
  "content-length",
  "content-range",
  "etag",
  "last-modified",
  "accept-ranges",
];

/**
 * A PDF rendered inline runs in this origin's context, where its own scripting
 * and form actions apply. Uploads are user content, so hand them to the viewer
 * as a download instead.
 */
function forceDownload(res: Response, file: string): void {
  if (file.toLowerCase().endsWith(".pdf")) res.setHeader("Content-Disposition", "attachment");
}

/** Whether a key is a real file under the local uploads folder. Missing keys are false. */
async function localUploadExists(key: string): Promise<boolean> {
  if (!isSafeUploadKey(key)) return false;
  const base = path.resolve(uploadsDir());
  const target = path.resolve(base, key);
  if (target !== base && !target.startsWith(base + path.sep)) return false;
  const stat = await fs.stat(target).catch(() => null);
  return Boolean(stat?.isFile());
}

function denyUpload(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store");
  res.status(404).end();
}

/**
 * A file still on local disk after `STORAGE_DRIVER=s3`.
 *
 * Served only when the live key is absent from the bucket and neither store
 * has a trash copy. The answer is not publicly cacheable: the file may move
 * to the bucket or into trash on the next write.
 */
async function sendHistoricalLocal(key: string, req: Request, res: Response): Promise<boolean> {
  const root = uploadsDir();
  const file = resolvePathUnderBase(root, key);
  if (!file) return false;
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return false;
  const remote = getUploadStore();
  for (const trash of trashedUploadKeyCandidates(key)) {
    if (isS3UploadStore(remote) && (await remote.exists(trash).catch(() => false))) return false;
    if (await localUploadExists(trash)) return false;
  }
  const part = parseByteRange(req.get("range"), stat.size);
  res.status(part ? 206 : 200);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Length", String(part ? part.end - part.start + 1 : stat.size));
  if (part) res.setHeader("Content-Range", `bytes ${part.start}-${part.end}/${stat.size}`);
  res.type(path.extname(key) || "application/octet-stream");
  forceDownload(res, key);
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  const body = createReadStream(file, part ? { start: part.start, end: part.end } : undefined);
  body.on("error", (err) => res.destroy(err));
  body.pipe(res);
  return true;
}

async function serveFromS3(
  store: S3UploadStore,
  maxAgeMs: number,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let key: string;
  try {
    key = decodeURIComponent(req.path.replace(/^\/+/, ""));
  } catch {
    next();
    return;
  }
  // Dot segments (`.trash`, probes) are never public — same as express.static.
  if (!isSafeUploadKey(key) || key.endsWith("/") || isPrivateUploadPath(key)) {
    denyUpload(res);
    return;
  }
  const cacheControl = `public, max-age=${Math.floor(maxAgeMs / 1000)}`;

  // A public bucket / CDN serves the bytes itself, and only after the object
  // is actually there. A setting is not proof that older files have moved.
  // The static exporter still gets the file inline.
  if (store.config.publicUrl && !req.get(STATIC_EXPORT_HEADER)) {
    if (await store.exists(key)) {
      res.setHeader("Cache-Control", cacheControl);
      res.redirect(302, `${store.config.publicUrl}/${encodeKeyPath(store.bucketKey(key))}`);
      return;
    }
    if (await sendHistoricalLocal(key, req, res)) return;
    denyUpload(res);
    return;
  }

  const passthrough: Record<string, string> = {};
  for (const name of PASSTHROUGH) {
    const value = req.get(name);
    if (value) passthrough[name] = value;
  }
  const upstream = await store.open(key, passthrough);
  if (upstream.status === 404 || upstream.status === 403) {
    await upstream.body?.cancel().catch(() => undefined);
    if (await sendHistoricalLocal(key, req, res)) return;
    denyUpload(res);
    return;
  }
  if (upstream.status >= 400) {
    await upstream.body?.cancel().catch(() => undefined);
    throw new Error(`Upload storage answered ${upstream.status} for ${key}`);
  }

  res.status(upstream.status);
  for (const name of RELAY) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  if (!upstream.headers.get("content-type"))
    res.type(path.extname(key) || "application/octet-stream");
  res.setHeader("Cache-Control", cacheControl);
  forceDownload(res, key);

  if (req.method === "HEAD" || !upstream.body || upstream.status === 304) {
    await upstream.body?.cancel().catch(() => undefined);
    res.end();
    return;
  }
  const body = Readable.fromWeb(
    upstream.body as import("node:stream/web").ReadableStream<Uint8Array>,
  );
  body.on("error", (err) => res.destroy(err));
  body.pipe(res);
}

/**
 * `/uploads` handler for the configured driver. The local folder is served by
 * express.static; S3 is proxied (or redirected to its public URL). The driver
 * is checked per request, so it follows the environment without a restart.
 */
/** True for a request path inside the private-files folder of the uploads bucket. */
export function isPrivateUploadPath(requestPath: string): boolean {
  let decoded = requestPath;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return true;
  }
  const parts = decoded.split(/[\\/]+/).filter(Boolean);
  if (parts.some((part) => part.startsWith("."))) return true;
  const first = parts[0] ?? "";
  return first.toLowerCase() === PRIVATE_UPLOADS_FOLDER || first.toLowerCase() === "static-export";
}

/**
 * After the request is authorized, nginx can read the file from an internal
 * location. `UPLOADS_ACCEL_REDIRECT` is that location's URL prefix. It is
 * never a public alias.
 */
async function handLocal(
  req: Request,
  res: Response,
  next: NextFunction,
  local: RequestHandler,
  maxAgeMs: number,
): Promise<void> {
  const accel = process.env.UPLOADS_ACCEL_REDIRECT?.trim().replace(/\/$/, "");
  if (accel && (req.method === "GET" || req.method === "HEAD")) {
    let key = req.path.replace(/^\/+/, "");
    try {
      key = decodeURIComponent(key);
    } catch {
      denyUpload(res);
      return;
    }
    const file = isSafeUploadKey(key) && !isPrivateUploadPath(key) ? resolvePathUnderBase(uploadsDir(), key) : null;
    const stat = file ? await fs.stat(file).catch(() => null) : null;
    if (file && stat?.isFile()) {
      res.setHeader("X-Accel-Redirect", `${accel}/${key.split("/").map(encodeURIComponent).join("/")}`);
      res.setHeader("Cache-Control", `public, max-age=${Math.floor(maxAgeMs / 1000)}`);
      forceDownload(res, key);
      res.end();
      return;
    }
  }
  local(req, res, next);
}

export function uploadsHandler(maxAgeMs: number): RequestHandler {
  const local = express.static(uploadsDir(), {
    maxAge: maxAgeMs,
    setHeaders: (res, filePath) => forceDownload(res, filePath),
  });
  return (req, res, next) => {
    // Private files, trash, and static-export metadata share the tree, but
    // cannot be read through /uploads. A shared cache must not store the refusal.
    if (isPrivateUploadPath(req.path)) {
      denyUpload(res);
      return;
    }
    let store;
    try {
      store = getUploadStore();
    } catch (err) {
      next(err);
      return;
    }
    if (!isS3UploadStore(store)) {
      void handLocal(req, res, next, local, maxAgeMs).catch(next);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    serveFromS3(store, maxAgeMs, req, res, next).catch(next);
  };
}
