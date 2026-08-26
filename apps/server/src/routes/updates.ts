import { Router } from "express";
import { applyCoreUpdate } from "../lib/core-updater.js";
import { runAllMigrations } from "../lib/run-migrations.js";
import { getDb } from "../lib/db.js";
import { getJustflowsVersion } from "../lib/version.js";
import { requireRole } from "../middleware/auth.js";
import { auditFromRequest } from "../lib/audit-log.js";
import multer from "multer";
import { sendServerError } from "../lib/send-error.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

router.get("/", requireRole("administrator"), (_req, res) => {
  res.json({ version: getJustflowsVersion(), updateAvailable: false });
});

router.post("/check", requireRole("administrator"), (_req, res) => {
  const version = getJustflowsVersion();
  res.json({ updateAvailable: false, currentVersion: version, latestVersion: version });
});

router.post("/upload", requireRole("administrator"), upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }

  // Replacing the core is the most consequential thing an administrator can
  // do, and it left no trace at all.
  auditFromRequest(req, "core.updated", {
    target: file.originalname,
    detail: `${Math.round(file.size / 1024 / 1024)}MB`,
  });
  const result = await applyCoreUpdate(file.buffer, file.originalname, {
    signature:
      typeof req.body?.signature === "string"
        ? req.body.signature
        : typeof req.headers["x-justflows-update-signature"] === "string"
          ? req.headers["x-justflows-update-signature"]
          : undefined,
  });
  res.json(result);
});

const dbRouter = Router();
dbRouter.post("/migrate", requireRole("administrator"), async (_req, res) => {
  try {
    const db = await getDb();
    const driver = process.env.DB_DRIVER as "postgres" | "mysql" | "mariadb";
    await runAllMigrations(db, driver);
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, "updates", err);
  }
});

export { dbRouter };
export default router;
