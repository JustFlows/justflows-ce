// SPDX-License-Identifier: MIT

import fs from "node:fs/promises";
import path from "node:path";
import { uploadsDir } from "../runtime/jf-root.js";
import {
  getUploadStore,
  isS3UploadStore,
  localUploadStore,
  type UploadStore,
} from "./upload-store.js";

export interface UploadSyncResult {
  copied: number;
  skipped: number;
  failed: string[];
}

const MIME_BY_EXT: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

/**
 * Copy every file in the local uploads folder into the configured S3 bucket,
 * key for key, so switching `STORAGE_DRIVER` to `s3` keeps existing media
 * URLs working. Files already in the bucket are skipped unless `overwrite`.
 * Local files are never deleted.
 */
export async function copyLocalUploadsToStore(
  opts: { overwrite?: boolean; dryRun?: boolean; log?: (line: string) => void } = {},
): Promise<UploadSyncResult> {
  const target = getUploadStore();
  if (!isS3UploadStore(target)) {
    throw new Error("STORAGE_DRIVER is not s3 — nothing to copy the local uploads into.");
  }
  const root = uploadsDir();
  const source = localUploadStore(root);
  const log = opts.log ?? (() => {});
  const result: UploadSyncResult = { copied: 0, skipped: 0, failed: [] };

  // Each top-level folder is one site (plus the legacy shared .trash).
  const keys = (await listRoot(root, source)).filter(
    (key) => !path.basename(key).startsWith(".healthcheck"),
  );
  for (const key of keys) {
    try {
      if (!opts.overwrite && (await target.exists(key))) {
        result.skipped++;
        continue;
      }
      if (opts.dryRun) {
        log(`would copy ${key}`);
        result.copied++;
        continue;
      }
      const body = await source.read(key);
      if (!body) continue;
      const type = MIME_BY_EXT[path.extname(key).toLowerCase()] ?? "application/octet-stream";
      await target.put(key, body, type);
      result.copied++;
      log(`copied ${key}`);
    } catch (err) {
      result.failed.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}

async function listRoot(root: string, store: UploadStore): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const keys: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) keys.push(...(await store.list(`${entry.name}/`)));
    else if (entry.isFile() && !entry.name.startsWith(".")) keys.push(entry.name);
  }
  return keys.sort();
}
