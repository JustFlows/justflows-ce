// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getDb } from "./db.js";
import { uploadsDir } from "./jf-root.js";
import { resolvePathUnderBase } from "./safe-path.js";
import { contentMatchesMimeType } from "./file-type.js";
import { checkLibraryQuota, formatMb } from "./media-quota.js";
import { moveMediaStorage } from "./trash.js";
import { auditLog } from "./audit-log.js";
import {
  generateAndStoreVariants,
  moveVariantDir,
  type MediaDerivatives,
} from "./media-responsive.js";

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
  return new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
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
  focalX?: number | null;
  focalY?: number | null;
  hasVariants?: boolean;
  uploadedAt: unknown;
}

export async function listMediaItems(siteId: string, limit: number): Promise<MediaItem[]> {
  const bounded = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 40, 200));
  const rows = await (
    await getDb()
  ).query<Record<string, unknown>>(
    "SELECT id, filename, mime_type, size_bytes, url, alt_text, caption, width, height, focal_x, focal_y, variants_generated_at, uploaded_at FROM media WHERE site_id = ? AND trashed_at IS NULL ORDER BY uploaded_at DESC LIMIT ?",
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
    focalX: r.focal_x == null ? null : Number(r.focal_x),
    focalY: r.focal_y == null ? null : Number(r.focal_y),
    hasVariants: r.variants_generated_at != null,
    uploadedAt: r.uploaded_at,
  }));
}

function parseDerivatives(raw: unknown): MediaDerivatives | null {
  if (!raw) return null;
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (raw === "" || raw === "{}") return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (value && typeof value === "object" && Array.isArray((value as MediaDerivatives).variants)) {
    return value as MediaDerivatives;
  }
  return null;
}

export interface MediaDetail extends MediaItem {
  storageKey: unknown;
  focalX: number | null;
  focalY: number | null;
  originalFormat: unknown;
  derivatives: MediaDerivatives | null;
}

export async function getMediaItem(siteId: string, id: string): Promise<MediaDetail | null> {
  const rows = await (
    await getDb()
  ).query<Record<string, unknown>>(
    "SELECT id, filename, mime_type, size_bytes, storage_key, url, alt_text, caption, width, height, focal_x, focal_y, original_format, derivatives, uploaded_at FROM media WHERE id = ? AND site_id = ? AND trashed_at IS NULL LIMIT 1",
    [id, siteId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    filename: r.filename,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    url: r.url,
    storageKey: r.storage_key,
    altText: r.alt_text,
    caption: r.caption,
    width: r.width,
    height: r.height,
    focalX: r.focal_x == null ? null : Number(r.focal_x),
    focalY: r.focal_y == null ? null : Number(r.focal_y),
    originalFormat: r.original_format,
    derivatives: parseDerivatives(r.derivatives),
    uploadedAt: r.uploaded_at,
  };
}

export interface MediaMetadataPatch {
  altText?: string | null;
  caption?: string | null;
  focalX?: number | null;
  focalY?: number | null;
}

/**
 * Update editable media metadata. Changing the focal point rebuilds that one
 * item's variant set inline so the art-directed thumbnail follows the subject.
 */
export async function updateMediaMetadata(
  id: string,
  actor: MediaActor,
  patch: MediaMetadataPatch,
): Promise<MediaWriteResult> {
  const current = await getMediaItem(actor.siteId, id);
  if (!current) return { status: 404, body: { error: "Media not found" } };

  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (patch.altText !== undefined) {
    sets.push("alt_text = ?");
    params.push(patch.altText === null ? null : String(patch.altText).slice(0, 2000));
  }
  if (patch.caption !== undefined) {
    sets.push("caption = ?");
    params.push(patch.caption === null ? null : String(patch.caption).slice(0, 2000));
  }

  const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
  const focalChanged =
    (patch.focalX !== undefined && patch.focalX !== null) ||
    (patch.focalY !== undefined && patch.focalY !== null);
  let focalX = current.focalX;
  let focalY = current.focalY;
  if (patch.focalX !== undefined) {
    focalX = patch.focalX === null ? null : clamp01(Number(patch.focalX));
    sets.push("focal_x = ?");
    params.push(focalX);
  }
  if (patch.focalY !== undefined) {
    focalY = patch.focalY === null ? null : clamp01(Number(patch.focalY));
    sets.push("focal_y = ?");
    params.push(focalY);
  }

  if (sets.length === 0) return { status: 200, body: { ok: true, unchanged: true } };

  sets.push("updated_at = ?");
  params.push(now());
  params.push(id, actor.siteId);
  await (
    await getDb()
  ).run(`UPDATE media SET ${sets.join(", ")} WHERE id = ? AND site_id = ?`, params);

  let derivatives = current.derivatives;
  if (focalChanged && String(current.mimeType).startsWith("image/")) {
    const originalBytes = await readOriginal(String(current.storageKey));
    if (originalBytes) {
      try {
        const rebuilt = await generateAndStoreVariants({
          siteId: actor.siteId,
          mediaId: id,
          filename: String(current.filename),
          mimeType: String(current.mimeType),
          buffer: originalBytes,
          focal: focalX != null && focalY != null ? { x: focalX, y: focalY } : null,
        });
        if (rebuilt) {
          derivatives = rebuilt;
          await (
            await getDb()
          ).run(
            "UPDATE media SET derivatives = ?, width = ?, height = ?, original_format = ?, variants_generated_at = ?, updated_at = ? WHERE id = ? AND site_id = ?",
            [
              JSON.stringify(rebuilt),
              rebuilt.base.w,
              rebuilt.base.h,
              rebuilt.base.format,
              now(),
              now(),
              id,
              actor.siteId,
            ],
          );
        }
      } catch (err) {
        console.error("[justflows] focal-point variant rebuild failed:", stripNewlines(err));
      }
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      id,
      altText: patch.altText !== undefined ? patch.altText : current.altText,
      caption: patch.caption !== undefined ? patch.caption : current.caption,
      focalX,
      focalY,
      derivatives,
    },
  };
}

async function readOriginal(storageKey: string): Promise<Buffer | null> {
  const abs = resolvePathUnderBase(uploadsDir(), storageKey);
  if (!abs) return null;
  try {
    return await fs.readFile(abs);
  } catch {
    return null;
  }
}

function stripNewlines(value: unknown): string {
  return (value instanceof Error ? value.message : String(value)).replace(/[\r\n]+/g, " ");
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

  // Responsive derivatives (resized variants + WebP/AVIF) are generated inline
  // so a page can ship a correct `srcset` on the first render. A failure here
  // is non-fatal — the original is already stored and the Tools → Regenerate
  // job can backfill.
  let derivatives: MediaDerivatives | null = null;
  try {
    derivatives = await generateAndStoreVariants({
      siteId: actor.siteId,
      mediaId: id,
      filename: file.originalname,
      mimeType: file.mimetype,
      buffer: file.buffer,
      focal: null,
    });
    if (derivatives) {
      await (
        await getDb()
      ).run(
        "UPDATE media SET derivatives = ?, width = ?, height = ?, original_format = ?, variants_generated_at = ?, updated_at = ? WHERE id = ? AND site_id = ?",
        [
          JSON.stringify(derivatives),
          derivatives.base.w,
          derivatives.base.h,
          derivatives.base.format,
          now(),
          now(),
          id,
          actor.siteId,
        ],
      );
    }
  } catch (err) {
    console.error("[justflows] media derivative generation failed:", stripNewlines(err));
  }

  return {
    status: 201,
    body: {
      id,
      filename: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      url,
      uploadedAt: now(),
      ...(derivatives
        ? {
            width: derivatives.base.w,
            height: derivatives.base.h,
            derivatives,
          }
        : {}),
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
  await moveVariantDir(actor.siteId, id, true).catch(() => undefined);
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
