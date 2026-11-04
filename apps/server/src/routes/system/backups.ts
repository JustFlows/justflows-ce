// SPDX-License-Identifier: MIT

import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { requireRole } from "../../middleware/auth.js";
import { auditFromRequest } from "../../lib/security/audit-log.js";
import { getDb } from "../../lib/database/db.js";
import {
  createPortableBackup,
  MAX_PORTABLE_BACKUP_BYTES,
  readPortableBackup,
} from "../../lib/backup/portable-archive.js";
import { exportSiteData } from "../../lib/backup/site-export.js";
import { restoreSiteBackup } from "../../lib/backup/site-restore.js";
import { getJustflowsVersion } from "../../lib/runtime/version.js";
import {
  admitUpload,
  multipartLimits,
  withMultipartErrors,
} from "../../lib/security/upload-admission.js";
import { param } from "../../lib/http/params.js";
import { z } from "zod";
import {
  backupDestinationSettings,
  deliverBackup,
  saveBackupDestinationSettings,
} from "../../lib/backup/destinations.js";

const router = Router();
const createLimit = rateLimit({
  windowMs: 60_000,
  limit: 3,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: multipartLimits(MAX_PORTABLE_BACKUP_BYTES),
});

interface BackupJob {
  id: string;
  siteId: string;
  status: "running" | "ready" | "failed" | "cancelled";
  progress: number;
  message: string;
  createdAt: number;
  controller: AbortController;
  archive?: Buffer;
  filename?: string;
  error?: string;
}

const backupJobs = new Map<string, BackupJob>();
const destinationSchema = z.object({
  ftp: z.object({
    enabled: z.boolean(),
    host: z.string().max(255),
    port: z.number().int().min(1).max(65535),
    username: z.string().max(255),
    password: z.string().max(1024).optional(),
    remotePath: z.string().max(1024),
    secure: z.boolean(),
  }),
  email: z.object({ enabled: z.boolean(), to: z.string().email().or(z.literal("")) }),
  s3: z.object({
    enabled: z.boolean(),
    bucket: z.string().max(255),
    region: z.string().max(100),
    endpoint: z.string().url().or(z.literal("")),
    accessKeyId: z.string().max(1024).optional(),
    secretAccessKey: z.string().max(1024).optional(),
    prefix: z.string().max(1024),
    forcePathStyle: z.boolean(),
  }),
});

function cleanupBackupJobs(): void {
  const cutoff = Date.now() - 15 * 60_000;
  for (const [id, job] of backupJobs) if (job.createdAt < cutoff) backupJobs.delete(id);
}

async function buildArchive(
  siteId: string,
  signal?: AbortSignal,
  progress?: (completed: number, total: number) => void,
): Promise<{ archive: Buffer; filename: string }> {
  const data = await exportSiteData(await getDb(), siteId, { signal, progress });
  if (signal?.aborted) throw new Error("Backup cancelled");
  const site = data.tables.sites?.[0];
  if (!site) throw new Error("Site not found");
  const createdAt = new Date().toISOString();
  return {
    archive: createPortableBackup({
      createdAt,
      source: {
        siteId,
        siteName: String(site.name ?? "Justflows site"),
        databaseDriver: (process.env.DB_DRIVER ?? "postgres") as "postgres" | "mysql" | "mariadb",
        coreVersion: getJustflowsVersion(),
      },
      data,
    }),
    filename: `justflows-backup-${createdAt.slice(0, 10)}.jfbackup`,
  };
}

router.post("/jobs", createLimit, requireRole("administrator"), (req, res) => {
  cleanupBackupJobs();
  const siteId = req.session!.siteId;
  const existing = [...backupJobs.values()].find(
    (job) => job.siteId === siteId && job.status === "running",
  );
  if (existing) {
    res.status(409).json({ error: "A backup is already running", jobId: existing.id });
    return;
  }
  const job: BackupJob = {
    id: randomUUID(),
    siteId,
    status: "running",
    progress: 5,
    message: "Reading site data",
    createdAt: Date.now(),
    controller: new AbortController(),
  };
  backupJobs.set(job.id, job);
  void buildArchive(siteId, job.controller.signal, (completed, total) => {
    job.message = total > 0 ? `Reading media ${completed}/${total}` : "Creating archive";
    job.progress = total > 0 ? 10 + Math.round((completed / total) * 75) : 85;
  })
    .then(({ archive, filename }) => {
      if (job.controller.signal.aborted) {
        job.status = "cancelled";
        job.message = "Backup cancelled";
        return;
      }
      job.archive = archive;
      job.filename = filename;
      job.progress = 100;
      job.status = "ready";
      job.message = "Backup ready";
    })
    .catch((error) => {
      job.status = job.controller.signal.aborted ? "cancelled" : "failed";
      job.error = error instanceof Error ? error.message : "Backup failed";
      job.message = job.error;
    });
  res.status(202).json({ jobId: job.id });
});

router.get("/jobs/:id", requireRole("administrator"), (req, res) => {
  cleanupBackupJobs();
  const job = backupJobs.get(param(req.params.id));
  if (!job || job.siteId !== req.session!.siteId) {
    res.status(404).json({ error: "Backup job not found" });
    return;
  }
  res.json({ status: job.status, progress: job.progress, message: job.message, error: job.error });
});

router.delete("/jobs/:id", requireRole("administrator"), (req, res) => {
  const job = backupJobs.get(param(req.params.id));
  if (!job || job.siteId !== req.session!.siteId) {
    res.status(404).json({ error: "Backup job not found" });
    return;
  }
  if (job.status === "running") job.controller.abort();
  job.archive = undefined;
  job.status = "cancelled";
  job.message = "Backup cancelled";
  res.json({ ok: true });
});

router.get("/jobs/:id/download", requireRole("administrator"), (req, res) => {
  const job = backupJobs.get(param(req.params.id));
  if (
    !job ||
    job.siteId !== req.session!.siteId ||
    job.status !== "ready" ||
    !job.archive ||
    !job.filename
  ) {
    res.status(404).json({ error: "Backup download is not ready" });
    return;
  }
  auditFromRequest(req, "backup.downloaded", {
    target: job.siteId,
    detail: `format=portable; bytes=${job.archive.byteLength}`,
  });
  res.set({
    "Content-Type": "application/vnd.justflows.backup",
    "Content-Disposition": `attachment; filename="${job.filename}"`,
    "Cache-Control": "private, no-store",
    "Content-Length": String(job.archive.byteLength),
  });
  res.send(job.archive);
  backupJobs.delete(job.id);
});

router.get("/destinations", requireRole("administrator"), async (req, res) => {
  res.json(await backupDestinationSettings(req.session!.siteId));
});

router.put("/destinations", requireRole("administrator"), async (req, res) => {
  const parsed = destinationSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid destination settings" });
    return;
  }
  await saveBackupDestinationSettings(req.session!.siteId, parsed.data);
  auditFromRequest(req, "backup.destinations_changed", { target: req.session!.siteId });
  res.json({ ok: true, settings: await backupDestinationSettings(req.session!.siteId) });
});

router.post("/jobs/:id/deliver", createLimit, requireRole("administrator"), async (req, res) => {
  const destination = z.enum(["ftp", "email", "s3"]).safeParse(req.body?.destination);
  const job = backupJobs.get(param(req.params.id));
  if (
    !destination.success ||
    !job ||
    job.siteId !== req.session!.siteId ||
    job.status !== "ready" ||
    !job.archive ||
    !job.filename
  ) {
    res.status(400).json({ error: "Backup job or destination is not ready" });
    return;
  }
  try {
    const location = await deliverBackup(job.siteId, destination.data, job.filename, job.archive);
    auditFromRequest(req, "backup.delivered", {
      target: job.siteId,
      detail: `destination=${destination.data}`,
    });
    res.json({ ok: true, location });
  } catch (error) {
    res
      .status(502)
      .json({ error: error instanceof Error ? error.message : "Backup delivery failed" });
  }
});

router.post("/download", createLimit, requireRole("administrator"), async (req, res) => {
  const siteId = req.session!.siteId;
  const db = await getDb();
  const data = await exportSiteData(db, siteId);
  const site = data.tables.sites?.[0];
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  const createdAt = new Date().toISOString();
  const archive = createPortableBackup({
    createdAt,
    source: {
      siteId,
      siteName: String(site.name ?? "Justflows site"),
      databaseDriver: (process.env.DB_DRIVER ?? "postgres") as "postgres" | "mysql" | "mariadb",
      coreVersion: getJustflowsVersion(),
    },
    data,
  });
  auditFromRequest(req, "backup.downloaded", {
    target: siteId,
    detail: `format=portable; bytes=${archive.byteLength}`,
  });
  res.set({
    "Content-Type": "application/vnd.justflows.backup",
    "Content-Disposition": `attachment; filename="justflows-backup-${createdAt.slice(0, 10)}.jfbackup"`,
    "Cache-Control": "private, no-store",
    "Content-Length": String(archive.byteLength),
  });
  res.send(archive);
});

router.post(
  "/validate",
  createLimit,
  requireRole("administrator"),
  admitUpload({ name: "backup", maxBytes: MAX_PORTABLE_BACKUP_BYTES, perSite: 1, global: 2 }),
  withMultipartErrors(upload.single("file")),
  async (req, res) => {
    if (!req.file || !req.file.originalname.toLowerCase().endsWith(".jfbackup")) {
      res.status(400).json({ error: "Select a .jfbackup file" });
      return;
    }
    try {
      const backup = readPortableBackup(req.file.buffer);
      const tables = Object.fromEntries(
        Object.entries(backup.data.tables).map(([name, rows]) => [name, rows.length]),
      );
      auditFromRequest(req, "backup.validated", {
        target: backup.source.siteId,
        detail: `format=v${backup.version}; bytes=${req.file.size}`,
      });
      res.json({
        ok: true,
        manifest: {
          version: backup.version,
          createdAt: backup.createdAt,
          source: backup.source,
          integrity: backup.integrity,
        },
        counts: {
          tables,
          plugins: backup.data.extensions.plugins.length,
          themes: backup.data.extensions.themes.length,
          mediaFiles: backup.data.files.length,
          mediaBytes: backup.data.files.reduce((total, file) => total + file.size, 0),
        },
        restoreAvailable: true,
      });
    } catch (error) {
      res
        .status(400)
        .json({ error: error instanceof Error ? error.message : "Backup validation failed" });
    }
  },
);

router.post(
  "/restore",
  createLimit,
  requireRole("administrator"),
  admitUpload({
    name: "backup-restore",
    maxBytes: MAX_PORTABLE_BACKUP_BYTES,
    perSite: 1,
    global: 1,
  }),
  withMultipartErrors(upload.single("file")),
  async (req, res) => {
    if (req.body?.confirmation !== "RESTORE CLEAN SITE") {
      res.status(400).json({ error: "Type RESTORE CLEAN SITE to confirm" });
      return;
    }
    if (!req.file || !req.file.originalname.toLowerCase().endsWith(".jfbackup")) {
      res.status(400).json({ error: "Select a .jfbackup file" });
      return;
    }
    try {
      const backup = readPortableBackup(req.file.buffer);
      await restoreSiteBackup(await getDb(), req.session!.siteId, backup);
      auditFromRequest(req, "backup.restored", {
        target: req.session!.siteId,
        detail: `source=${backup.source.siteId}`,
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : "Restore failed" });
    }
  },
);

export default router;
