import { Router } from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getDb } from "../lib/db.js";
import { uploadsDir } from "../lib/jf-root.js";
import { requireRole } from "../middleware/auth.js";
import { MEDIA_WRITE_ROLES } from "../lib/rbac.js";
import { contentMatchesMimeType } from "../lib/file-type.js";
import { checkLibraryQuota, formatMb, maxUploadBytes } from "../lib/media-quota.js";
import multer, { MulterError } from "multer";
import { sendServerError } from "../lib/send-error.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxUploadBytes() } });

/**
 * multer rejects an oversized file by throwing, which the global handler turns
 * into a flat 500 — so the one thing the uploader needs to know (the file is
 * too big, and by how much) was the one thing they were not told.
 */
function uploadSingle(field: string) {
  return (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    upload.single(field)(req, res, (err: unknown) => {
      if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: `File is too large (limit ${formatMb(maxUploadBytes())}).` });
        return;
      }
      next(err);
    });
  };
}

const ALLOWED_TYPES = new Set([
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

router.get("/", requireRole(...MEDIA_WRITE_ROLES), async (req, res) => {
  const session = req.session!;
  const limit = Math.min(Number(req.query.limit ?? "40"), 200);

  try {
    const db = await getDb();
    const rows = await db.query<Record<string, unknown>>(
      "SELECT id, filename, mime_type, size_bytes, url, alt_text, caption, width, height, uploaded_at FROM media WHERE site_id = ? ORDER BY uploaded_at DESC LIMIT ?",
      [session.siteId, limit],
    );
    // The admin UI (and this route's own POST response) use camelCase — map
    // the raw SQL columns rather than aliasing them in the query, since an
    // unquoted "AS mimeType" gets folded to "mimetype" on postgres.
    const items = rows.map((r) => ({
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
    res.json({ items });
  } catch (err) {
    sendServerError(res, "media", err);
  }
});

router.post("/", requireRole(...MEDIA_WRITE_ROLES), uploadSingle("file"), async (req, res) => {
  const session = req.session!;
  const file = req.file;

  if (!file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }

  if (!ALLOWED_TYPES.has(file.mimetype)) {
    res.status(415).json({ error: `File type not allowed: ${file.mimetype}` });
    return;
  }

  const ext = MIME_TO_EXT[file.mimetype];
  if (!ext) {
    res.status(415).json({ error: `File type not allowed: ${file.mimetype}` });
    return;
  }

  // file.mimetype is the client's own claim. Confirm the bytes agree, so the
  // library cannot be used to store arbitrary content under an image extension.
  if (!contentMatchesMimeType(file.buffer, file.mimetype)) {
    res.status(415).json({
      error: `File contents do not match the declared type (${file.mimetype})`,
    });
    return;
  }

  // Checked after the type checks, so a rejected file type does not report a
  // quota figure to someone probing the library's size.
  const quota = await checkLibraryQuota(session.siteId, file.size);
  if (!quota.ok) {
    res.status(413).json({
      error:
        `The media library is full (${formatMb(quota.usedBytes)} of ${formatMb(quota.limitBytes)} used). ` +
        "Delete something, or raise JF_MAX_LIBRARY_MB.",
    });
    return;
  }

  try {
    const baseDir = uploadsDir();
    const storageKey = `${session.siteId}/${randomUUID()}${ext}`;
    const filePath = path.join(baseDir, storageKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.buffer);

    const url = `/uploads/${storageKey}`;
    const id = randomUUID();
    const db = await getDb();

    await db.run(
      `INSERT INTO media (id, site_id, filename, mime_type, size_bytes, storage_key, url, uploaded_by, uploaded_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        session.siteId,
        file.originalname,
        file.mimetype,
        file.size,
        storageKey,
        url,
        session.userId,
        now(),
        now(),
      ],
    );

    res.status(201).json({
      id,
      filename: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      url,
      uploadedAt: now(),
    });
  } catch (err) {
    sendServerError(res, "media", err);
  }
});

export default router;
