// SPDX-License-Identifier: MIT

import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import multer, { MulterError } from "multer";
import { getDb } from "../../lib/database/db.js";
import { maxUploadBytes, formatMb } from "../../lib/media/media-quota.js";
import {
  listMediaItems,
  storeMediaUpload,
  trashMediaItem,
  updateMediaMetadata,
} from "../../lib/media/media-write.js";
import { clientIp } from "../../lib/security/rate-limit.js";
import { sendServerError } from "../../lib/http/send-error.js";
import { badRequest, ensureKeyCan, notFound, paginate, relay, sendJson } from "./envelope.js";
import { admitUpload } from "../../lib/security/upload-admission.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxUploadBytes() } });
const admitMediaUpload = admitUpload({ name: "media", maxBytes: maxUploadBytes(), perSite: 4, global: 16 });

// Writing an uploaded file to disk is expensive work; CodeQL only models
// express-rate-limit, so it guards this route directly in addition to the
// per-key limiter on the whole surface.
const uploadLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `manage-media-upload:${req.apiKey?.id ?? clientIp(req)}`,
});

router.get("/", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "media:read"))) return;
  try {
    const items = await listMediaItems(req.apiKeyOwner!.siteId, 200);
    sendJson(req, res, paginate(items, req));
  } catch (err) {
    sendServerError(res, "manage.media", err);
  }
});

router.get("/:id", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "media:read"))) return;
  try {
    const rows = await (
      await getDb()
    ).query<Record<string, unknown>>(
      "SELECT id, filename, mime_type, size_bytes, url, alt_text, caption, width, height, uploaded_at FROM media WHERE id = ? AND site_id = ? AND trashed_at IS NULL LIMIT 1",
      [req.params.id, req.apiKeyOwner!.siteId],
    );
    if (!rows[0]) return notFound(res, "Media not found");
    sendJson(req, res, rows[0]);
  } catch (err) {
    sendServerError(res, "manage.media", err);
  }
});

router.post("/", uploadLimit, (req, res) => {
  void (async () => {
    if (!(await ensureKeyCan(req, res, "media:upload"))) return;
    admitMediaUpload(req, res, () => upload.single("file")(req, res, (err: unknown) => {
      void (async () => {
        if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
          return badRequest(res, `File is too large (limit ${formatMb(maxUploadBytes())}).`);
        }
        if (err) return sendServerError(res, "manage.media", err);
        const file = req.file;
        if (!file) return badRequest(res, "No file provided");
        try {
          relay(
            res,
            await storeMediaUpload(
              {
                originalname: file.originalname,
                mimetype: file.mimetype,
                size: file.size,
                buffer: file.buffer,
              },
              { siteId: req.apiKeyOwner!.siteId, userId: req.apiKeyOwner!.userId, role: "api-key" },
            ),
          );
        } catch (uploadErr) {
          sendServerError(res, "manage.media", uploadErr);
        }
      })();
    }));
  })();
});

const MetadataSchema = z.object({
  altText: z.string().max(2000).nullable().optional(),
  caption: z.string().max(2000).nullable().optional(),
  focalX: z.number().min(0).max(1).nullable().optional(),
  focalY: z.number().min(0).max(1).nullable().optional(),
});

// Same capability the media library needs to change an item's details.
router.patch("/:id", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "media:upload"))) return;
  const body = MetadataSchema.safeParse(req.body ?? {});
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid metadata");
  try {
    relay(
      res,
      await updateMediaMetadata(
        req.params.id,
        {
          siteId: req.apiKeyOwner!.siteId,
          userId: req.apiKeyOwner!.userId,
          role: "api-key",
          ip: clientIp(req),
          userAgent: req.get("user-agent") ?? null,
        },
        body.data,
      ),
    );
  } catch (err) {
    sendServerError(res, "manage.media", err);
  }
});

router.delete("/:id", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "media:delete"))) return;
  try {
    relay(
      res,
      await trashMediaItem(req.params.id, {
        siteId: req.apiKeyOwner!.siteId,
        userId: req.apiKeyOwner!.userId,
        role: "api-key",
        ip: clientIp(req),
        userAgent: req.get("user-agent") ?? null,
      }),
    );
  } catch (err) {
    sendServerError(res, "manage.media", err);
  }
});

export default router;
