import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireRole } from "../middleware/auth.js";
import { MEDIA_WRITE_ROLES } from "../lib/rbac.js";
import { formatMb, maxUploadBytes } from "../lib/media-quota.js";
import multer, { MulterError } from "multer";
import { sendServerError } from "../lib/send-error.js";
import { param } from "../lib/params.js";
import { listMediaItems, storeMediaUpload, trashMediaItem } from "../lib/media-write.js";

const router = Router();
const mediaUploadRequestLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxUploadBytes() } });

/**
 * multer rejects an oversized file by throwing, which the global handler turns
 * into a flat 500 — so the one thing the uploader needs to know (the file is
 * too big, and by how much) was the one thing they were not told.
 */
function uploadSingle(field: string) {
  return (
    req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction,
  ) => {
    upload.single(field)(req, res, (err: unknown) => {
      if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: `File is too large (limit ${formatMb(maxUploadBytes())}).` });
        return;
      }
      next(err);
    });
  };
}

router.get("/", requireRole(...MEDIA_WRITE_ROLES), async (req, res) => {
  const session = req.session!;
  try {
    const items = await listMediaItems(session.siteId, Number(req.query.limit ?? "40"));
    res.json({ items });
  } catch (err) {
    sendServerError(res, "media", err);
  }
});

router.post(
  "/",
  mediaUploadRequestLimit,
  requireRole(...MEDIA_WRITE_ROLES),
  uploadSingle("file"),
  async (req, res) => {
    const session = req.session!;
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }
    try {
      const result = await storeMediaUpload(
        {
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          buffer: file.buffer,
        },
        { siteId: session.siteId, userId: session.userId, role: session.role },
      );
      res.status(result.status).json(result.body);
    } catch (err) {
      sendServerError(res, "media", err);
    }
  },
);

router.delete("/:id", requireRole(...MEDIA_WRITE_ROLES), async (req, res) => {
  const session = req.session!;
  try {
    const result = await trashMediaItem(param(req.params.id), {
      siteId: session.siteId,
      userId: session.userId,
      role: session.role,
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    sendServerError(res, "media", err);
  }
});

export default router;
