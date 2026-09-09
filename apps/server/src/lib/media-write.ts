// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getDb } from "./db.js";
import { uploadsDir } from "./jf-root.js";
import { contentMatchesMimeType } from "./file-type.js";
import { checkLibraryQuota, formatMb } from "./media-quota.js";
import { moveMediaStorage } from "./trash.js";
import { auditLog } from "./audit-log.js";

/**
 * Shared media-library write logic behind both `routes/media.ts` (cookie auth)
 * and the federated management API. The multipart parsing stays with the
 * callers; this module validates the bytes, enforces the quota, writes the file
 * and the row, and moves storage to trash on delete.
 */

export const MEDIA_ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/ico",
  "application/pdf",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/ogg",
]);

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/x-icon": ".ico",
  "image/vnd.microsoft.icon": ".ico",
  "image/ico": ".ico",
  "application/pdf": ".pdf",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
};

function now(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

export interface MediaActor {
  siteId: string;
  userId: string;
  role?: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface MediaItem {
  id: unknown;
  filename: unknown;
  mimeType: unknown;
  sizeBytes: unknown;
  url: unknown;
  altText: unknown;
  caption: unknown;
  width: unknown;
  height: unknown;
  uploadedAt: unknown;
}

export async function listMediaItems(siteId: string, limit: number): Promise<MediaItem[]> {
  const bounded = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 40, 200));
  const rows = await (
    await getDb()
  ).query<Record<string, unknown>>(
    "SELECT id, filename, mime_type, size_bytes, url, alt_text, caption, width, height, uploaded_at FROM media WHERE site_id = ? AND trashed_at IS NULL ORDER BY uploaded_at DESC LIMIT ?",
    [siteId, bounded],
  );
  // camelCase mapping done here rather than via `AS` — an unquoted alias folds
  // to lowercase on PostgreSQL.
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    url: r.url,
    altText: r.alt_text,
    caption: r.caption,
    width: r.width,
    height: r.height,
    uploadedAt: r.uploaded_at,
  }));
}

export interface UploadInput {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface MediaWriteResult {
  status: number;
  body: unknown;
}

export async function storeMediaUpload(
  file: UploadInput,
  actor: MediaActor,
): Promise<MediaWriteResult> {
  if (!MEDIA_ALLOWED_TYPES.has(file.mimetype)) {
    return { status: 415, body: { error: `File type not allowed: ${file.mimetype}` } };
  }
  const ext = MIME_TO_EXT[file.mimetype];
  if (!ext) {
    return { status: 415, body: { error: `File type not allowed: ${file.mimetype}` } };
  }
  // file.mimetype is the client's claim; confirm the bytes agree.
  if (!contentMatchesMimeType(file.buffer, file.mimetype)) {
    return {
      status: 415,
      body: { error: `File contents do not match the declared type (${file.mimetype})` },
    };
  }
  // Checked after the type checks, so a rejected type never reports a quota figure.
  const quota = await checkLibraryQuota(actor.siteId, file.size);
  if (!quota.ok) {
    return {
      status: 413,
      body: {
        error:
          `The media library is full (${formatMb(quota.usedBytes)} of ${formatMb(quota.limitBytes)} used). ` +
          "Delete something, or raise JF_MAX_LIBRARY_MB.",
      },
    };
  }

  const baseDir = uploadsDir();
  const storageKey = `${actor.siteId}/${randomUUID()}${ext}`;
  const filePath = path.join(baseDir, storageKey);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, file.buffer);

  const url = `/uploads/${storageKey}`;
  const id = randomUUID();
  await (
    await getDb()
  ).run(
    `INSERT INTO media (id, site_id, filename, mime_type, size_bytes, storage_key, url, uploaded_by, uploaded_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      actor.siteId,
      file.originalname,
      file.mimetype,
      file.size,
      storageKey,
      url,
      actor.userId,
      now(),
      now(),
    ],
  );

  return {
    status: 201,
    body: {
      id,
      filename: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      url,
      uploadedAt: now(),
    },
  };
}

export async function trashMediaItem(id: string, actor: MediaActor): Promise<MediaWriteResult> {
  const db = await getDb();
  const rows = await db.query<{ id: string; storage_key: string }>(
    "SELECT id, storage_key FROM media WHERE id = ? AND site_id = ? AND trashed_at IS NULL LIMIT 1",
    [id, actor.siteId],
  );
  if (!rows[0]) return { status: 404, body: { error: "Media not found" } };
  await moveMediaStorage(rows[0].storage_key, true);
  await db.run(
    "UPDATE media SET trashed_at = ?, trashed_by = ?, updated_at = ? WHERE id = ? AND site_id = ?",
    [now(), actor.userId, now(), id, actor.siteId],
  );
  void auditLog({
    siteId: actor.siteId,
    action: "trash.trashed",
    actorId: actor.userId,
    actorRole: actor.role ?? null,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
    target: id,
    detail: "type=media",
  });
  return { status: 200, body: { ok: true } };
}
