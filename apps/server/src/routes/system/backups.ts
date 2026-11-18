// SPDX-License-Identifier: MIT

import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { z } from "zod";
import { requireRole } from "../../middleware/auth.js";
import { auditFromRequest } from "../../lib/security/audit-log.js";
import { getDb } from "../../lib/database/db.js";
import { param } from "../../lib/http/params.js";
import { getJustflowsVersion } from "../../lib/runtime/version.js";
import { isInstallationRootRequest, isPlatformOperator } from "../../lib/tenancy/access.js";
import { admitUpload, multipartLimits, withMultipartErrors } from "../../lib/security/upload-admission.js";
import { assertPassphrase, BackupPassphraseError, isEncryptedBackup, openBackup } from "../../lib/backup/archive-crypto.js";
import { MAX_BACKUP_BYTES, openBackupContainer, type BackupManifest, type BackupReader } from "../../lib/backup/backup-container.js";
import { readPortableBackup } from "../../lib/backup/portable-archive.js";
import {
  buildNetworkBackup,
  buildSiteBackup,
  buildSubsiteBackups,
  workspaceRestoreTargets,
  type BackupArtifact,
} from "../../lib/backup/workspace-backup.js";
import {
  restoreNetwork,
  restoreSingleSite,
  restoreTargetState,
  summarizeBackup,
  unavailableExtensions,
  type RestorePlan,
} from "../../lib/backup/restore-backup.js";
import {
  discardBackupJob,
  getBackupJob,
  readBackupJobFile,
  runningBackupJob,
  saveRollbackSnapshot,
  startBackupJob,
} from "../../lib/backup/backup-jobs.js";
import { backupScheduleSettings, enqueueAutomaticBackup, saveBackupSchedule } from "../../lib/backup/scheduled-backups.js";
import { backupDestinationSettings, deliverBackup, saveBackupDestinationSettings } from "../../lib/backup/destinations.js";

const router = Router();
const createLimit = rateLimit({ windowMs: 60_000, limit: 3, standardHeaders: "draft-8", legacyHeaders: false });
const readLimit = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false });
const upload = multer({ storage: multer.memoryStorage(), limits: multipartLimits(MAX_BACKUP_BYTES) });
const SITE_RESTORE_PHRASE = "RESTORE SITE";
const NETWORK_RESTORE_PHRASE = "RESTORE NETWORK";

const connectionSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  database: z.string().min(1).max(128),
  username: z.string().min(1).max(128),
  password: z.string().max(1024),
});
const planSchema = z.object({
  hostnames: z
    .record(z.string().max(64), z.array(z.object({ hostname: z.string().max(253), primary: z.boolean().optional() })).max(50))
    .optional(),
  siteDatabases: z
    .record(
      z.string().max(64),
      z.discriminatedUnion("mode", [
        z.object({ mode: z.literal("workspace") }),
        z.object({ mode: z.literal("backup") }),
        z.object({ mode: z.literal("custom"), connection: connectionSchema }),
      ]),
    )
    .optional(),
  pluginDatabases: z
    .record(
      z.string().max(64),
      z.record(
        z.string().max(200),
        z.discriminatedUnion("mode", [
          z.object({ mode: z.literal("backup") }),
          z.object({ mode: z.literal("site") }),
          z.object({
            mode: z.literal("custom"),
            connection: connectionSchema.extend({ driver: z.enum(["postgres", "mysql", "mariadb"]), ssl: z.boolean().optional() }),
          }),
        ]),
      ),
    )
    .optional(),
});
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
const scheduleSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  timeUtc: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  weekday: z.number().int().min(0).max(6),
  dayOfMonth: z.number().int().min(1).max(31),
  scope: z.enum(["root", "subsites", "all", "network"]),
  destination: z.enum(["ftp", "email", "s3"]),
  passphrase: z.string().max(1024).optional(),
});

function requireInstallationRoot(_req: Request, res: Response, next: NextFunction): void {
  if (!isInstallationRootRequest()) {
    res.status(403).json({ error: "This is only available on the installation root site" });
    return;
  }
  next();
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function driver(): "postgres" | "mysql" | "mariadb" {
  const value = process.env.DB_DRIVER;
  return value === "mysql" || value === "mariadb" ? value : "postgres";
}

/** A Justflows 0.4 file: one unencrypted site snapshot, presented through the same reader. */
function legacyReader(file: Buffer): BackupReader {
  const envelope = readPortableBackup(file);
  const manifest: BackupManifest = {
    format: "justflows-backup",
    version: 2,
    kind: "site",
    createdAt: envelope.createdAt,
    source: envelope.source,
    installation: null,
    sites: [{ siteId: envelope.source.siteId, siteName: envelope.source.siteName, root: false, hostnames: [], offset: 0, length: file.byteLength, sha256: "" }],
    packages: [],
    extensions: { plugins: [], themes: [] },
    integrity: { algorithm: "sha256", manifest: "" },
  };
  return {
    manifest,
    readSite: () => envelope,
    packageBytes: () => {
      throw new Error("This backup has no package files");
    },
  };
}

/** Decrypt and open an uploaded backup; an older unencrypted file is still accepted. */
function openUpload(req: Request): { reader: BackupReader; legacy: boolean } {
  const file = req.file;
  if (!file || !file.originalname.toLowerCase().endsWith(".jfbackup")) throw new Error("Select a .jfbackup file");
  if (!isEncryptedBackup(file.buffer)) return { reader: legacyReader(file.buffer), legacy: true };
  const { plaintext } = openBackup(file.buffer, String(req.body?.passphrase ?? ""));
  return { reader: openBackupContainer(plaintext), legacy: false };
}

function parsePlan(raw: unknown): RestorePlan {
  let value: unknown = {};
  try {
    value = JSON.parse(String(raw ?? "{}"));
  } catch {
    throw new Error("The restore choices are not valid");
  }
  const parsed = planSchema.safeParse(value);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "The restore choices are not valid");
  return parsed.data as RestorePlan;
}

router.post("/jobs", createLimit, requireRole("administrator"), async (req, res) => {
  const siteId = req.session!.siteId;
  const scope = req.body?.scope === "subsites" || req.body?.scope === "network" ? (req.body.scope as "subsites" | "network") : "site";
  if (scope !== "site" && !isInstallationRootRequest()) {
    res.status(403).json({ error: "Subsite and network backups are only available from the installation root site" });
    return;
  }
  let passphrase: string;
  try {
    passphrase = assertPassphrase(req.body?.passphrase);
  } catch (error) {
    res.status(400).json({ error: errorMessage(error, "Enter a backup passphrase") });
    return;
  }
  const running = await runningBackupJob(siteId, ["backup"]);
  if (running) {
    res.status(409).json({ error: "A backup is already running", jobId: running.id });
    return;
  }
  const root = isInstallationRootRequest();
  const jobId = await startBackupJob({ siteId, kind: "backup", scope, message: "Reading site data" }, async (job) => {
    const options = {
      passphrase,
      createdAt: new Date().toISOString(),
      databaseDriver: driver(),
      coreVersion: getJustflowsVersion(),
      signal: job.signal,
      progress: (completed: number, total: number) =>
        job.progress(10 + (total > 0 ? (completed / total) * 80 : 80), `Reading ${scope === "site" ? "media" : "sites"} ${completed}/${total}`),
    };
    let artifacts: BackupArtifact[];
    if (scope === "network") artifacts = [await buildNetworkBackup(siteId, options)];
    else if (scope === "subsites") artifacts = await buildSubsiteBackups(siteId, options);
    else artifacts = [await buildSiteBackup(siteId, options, root ? "root" : "site")];
    return { artifacts };
  });
  res.status(202).json({ jobId });
});

router.get("/jobs/:id", readLimit, requireRole("administrator"), async (req, res) => {
  const job = await getBackupJob(param(req.params.id), req.session!.siteId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    id: job.id,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error ?? undefined,
    result: job.result ?? undefined,
    files:
      job.status === "ready"
        ? job.files.map((file) => ({ index: file.index, siteId: file.siteId, siteName: file.siteName, filename: file.filename }))
        : undefined,
  });
});

router.delete("/jobs/:id", readLimit, requireRole("administrator"), async (req, res) => {
  const job = await getBackupJob(param(req.params.id), req.session!.siteId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  await discardBackupJob(job);
  res.json({ ok: true });
});

router.get("/jobs/:id/download/:index", readLimit, requireRole("administrator"), async (req, res) => {
  const job = await getBackupJob(param(req.params.id), req.session!.siteId);
  const file = job?.status === "ready" ? job.files.find((item) => item.index === Number(param(req.params.index))) : undefined;
  const bytes = job && file ? await readBackupJobFile(job, file) : null;
  if (!job || !file || !bytes) {
    res.status(404).json({ error: "Backup download is not ready" });
    return;
  }
  auditFromRequest(req, "backup.downloaded", { target: job.siteId, detail: `format=encrypted; source=${file.siteId}; bytes=${bytes.byteLength}` });
  res.set({
    "Content-Type": "application/vnd.justflows.backup",
    "Content-Disposition": `attachment; filename="${file.filename}"`,
    "Cache-Control": "private, no-store",
    "Content-Length": String(bytes.byteLength),
  });
  res.send(bytes);
});

router.post("/jobs/:id/deliver", createLimit, requireRole("administrator"), async (req, res) => {
  const destination = z.enum(["ftp", "email", "s3"]).safeParse(req.body?.destination);
  const job = await getBackupJob(param(req.params.id), req.session!.siteId);
  if (!destination.success || !job || job.status !== "ready" || job.files.length === 0) {
    res.status(400).json({ error: "Backup job or destination is not ready" });
    return;
  }
  try {
    const locations: string[] = [];
    for (const file of job.files) {
      const bytes = await readBackupJobFile(job, file);
      if (!bytes) throw new Error("The backup file is no longer available");
      locations.push(await deliverBackup(job.siteId, destination.data, file.filename, bytes));
    }
    auditFromRequest(req, "backup.delivered", { target: job.siteId, detail: `destination=${destination.data}` });
    res.json({ ok: true, location: locations.join(", ") });
  } catch (error) {
    res.status(502).json({ error: errorMessage(error, "Backup delivery failed") });
  }
});

router.get("/destinations", requireRole("administrator"), async (req, res) => {
  res.json(await backupDestinationSettings(req.session!.siteId));
});

router.put("/destinations", requireRole("administrator"), async (req, res) => {
  const parsed = destinationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid destination settings" });
    return;
  }
  await saveBackupDestinationSettings(req.session!.siteId, parsed.data);
  auditFromRequest(req, "backup.destinations_changed", { target: req.session!.siteId });
  res.json({ ok: true, settings: await backupDestinationSettings(req.session!.siteId) });
});

router.get("/schedule", requireRole("administrator"), requireInstallationRoot, async (req, res) => {
  res.json(await backupScheduleSettings(req.session!.siteId));
});

router.put("/schedule", requireRole("administrator"), requireInstallationRoot, async (req, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid backup schedule" });
    return;
  }
  try {
    const { passphrase, ...rest } = parsed.data;
    const settings = await saveBackupSchedule(req.session!.siteId, { ...rest, ...(passphrase ? { passphrase } : {}) });
    auditFromRequest(req, "backup.schedule_changed", {
      target: req.session!.siteId,
      detail: `enabled=${settings.enabled}; frequency=${settings.frequency}; scope=${settings.scope}; destination=${settings.destination}; passphrase=${passphrase ? "changed" : "kept"}`,
    });
    res.json(settings);
  } catch (error) {
    res.status(400).json({ error: errorMessage(error, "Invalid backup schedule") });
  }
});

router.post("/schedule/run-now", createLimit, requireRole("administrator"), requireInstallationRoot, async (req, res) => {
  const settings = await backupScheduleSettings(req.session!.siteId);
  if (!settings.passphraseSet) {
    res.status(400).json({ error: "Set a backup passphrase before running automatic backups" });
    return;
  }
  const jobId = await enqueueAutomaticBackup(req.session!.siteId, settings);
  auditFromRequest(req, "backup.schedule_started", { target: req.session!.siteId, detail: `job=${jobId}` });
  res.status(202).json({ ok: true, jobId });
});

router.get("/restore-targets", requireRole("administrator"), async (req, res) => {
  if (isInstallationRootRequest()) {
    res.json({ sites: await workspaceRestoreTargets(req.session!.siteId) });
    return;
  }
  const rows = await (await getDb()).query<{ id: string; name: string }>("SELECT id, name FROM sites WHERE id = ? LIMIT 1", [req.session!.siteId]);
  res.json({ sites: rows.map((site) => ({ ...site, root: false })) });
});

router.post(
  "/validate",
  createLimit,
  requireRole("administrator"),
  admitUpload({ name: "backup", maxBytes: MAX_BACKUP_BYTES, perSite: 1, global: 1 }),
  withMultipartErrors(upload.single("file")),
  async (req, res) => {
    try {
      const { reader, legacy } = openUpload(req);
      const summary = summarizeBackup(reader);
      let restoreBlockedReason: "notRoot" | "notClean" | "multisiteOff" | "notOperator" | null = null;
      let target = null;
      if (summary.kind === "network") {
        target = isInstallationRootRequest() ? await restoreTargetState(req.session!.siteId) : null;
        const hasSubsites = summary.sites.length > 1;
        const operator = await isPlatformOperator(req.session!.userId);
        restoreBlockedReason = !target
          ? "notRoot"
          : !target.clean
            ? "notClean"
            : hasSubsites && !target.multisite
              ? "multisiteOff"
              : hasSubsites && !operator
                ? "notOperator"
                : null;
      }
      auditFromRequest(req, "backup.validated", {
        target: summary.source.siteId,
        detail: `kind=${summary.kind}; legacy=${legacy}; sites=${summary.sites.length}; bytes=${req.file!.size}`,
      });
      res.json({
        ok: true,
        legacy,
        summary,
        target,
        unavailable: await unavailableExtensions(reader),
        restoreAvailable: restoreBlockedReason === null,
        restoreBlockedReason,
      });
    } catch (error) {
      res.status(error instanceof BackupPassphraseError ? 422 : 400).json({ error: errorMessage(error, "Backup validation failed") });
    }
  },
);

router.post(
  "/restore",
  createLimit,
  requireRole("administrator"),
  admitUpload({ name: "backup-restore", maxBytes: MAX_BACKUP_BYTES, perSite: 1, global: 1 }),
  withMultipartErrors(upload.single("file")),
  async (req, res) => {
    if (req.body?.confirmation !== SITE_RESTORE_PHRASE) {
      res.status(400).json({ error: `Type ${SITE_RESTORE_PHRASE} to confirm` });
      return;
    }
    let reader: BackupReader;
    let plan: RestorePlan;
    try {
      reader = openUpload(req).reader;
      plan = parsePlan(req.body?.plan);
    } catch (error) {
      res.status(error instanceof BackupPassphraseError ? 422 : 400).json({ error: errorMessage(error, "Backup validation failed") });
      return;
    }
    if (reader.manifest.kind !== "site") {
      res.status(400).json({ error: "This is a network backup. Restore it with Restore network on the installation root." });
      return;
    }
    const root = isInstallationRootRequest();
    const requested = String(req.body?.targetSiteId ?? req.session!.siteId);
    const targets = root ? await workspaceRestoreTargets(req.session!.siteId) : [{ id: req.session!.siteId, name: "", root: false }];
    const target = targets.find((site) => String(site.id) === requested);
    if (!target) {
      res.status(403).json({ error: "Restore target is outside this workspace" });
      return;
    }
    if (await runningBackupJob(null, ["restore", "network-restore"])) {
      res.status(409).json({ error: "A restore is already running" });
      return;
    }
    const sourceId = reader.manifest.source.siteId;
    const installationRoot = root && (target.root === true || Number(target.root) === 1);
    const jobId = await startBackupJob({ siteId: req.session!.siteId, kind: "restore", scope: "site", message: "Checking the backup" }, async (job) => {
      try {
        const result = await restoreSingleSite({
          targetSiteId: requested,
          installationRoot,
          actorId: req.session!.userId,
          reader,
          plan,
          signal: job.signal,
          progress: (completed, total, message) => job.progress((completed / total) * 100, message),
          onSnapshot: (snapshot) => saveRollbackSnapshot(job.jobId, requested, snapshot),
        });
        auditFromRequest(req, "backup.restored", { target: requested, detail: `source=${sourceId}` });
        return { result };
      } catch (error) {
        auditFromRequest(req, "backup.restored", { target: requested, outcome: "failure", detail: `source=${sourceId}` });
        throw error;
      }
    });
    res.status(202).json({ jobId });
  },
);

router.post(
  "/network/restore",
  createLimit,
  requireRole("administrator"),
  requireInstallationRoot,
  admitUpload({ name: "backup-restore", maxBytes: MAX_BACKUP_BYTES, perSite: 1, global: 1 }),
  withMultipartErrors(upload.single("file")),
  async (req, res) => {
    if (req.body?.confirmation !== NETWORK_RESTORE_PHRASE) {
      res.status(400).json({ error: `Type ${NETWORK_RESTORE_PHRASE} to confirm` });
      return;
    }
    let reader: BackupReader;
    let plan: RestorePlan;
    try {
      reader = openUpload(req).reader;
      plan = parsePlan(req.body?.plan);
    } catch (error) {
      res.status(error instanceof BackupPassphraseError ? 422 : 400).json({ error: errorMessage(error, "Backup validation failed") });
      return;
    }
    if (reader.manifest.kind !== "network") {
      res.status(400).json({ error: "This is a single-site backup. Restore it into one site." });
      return;
    }
    if (reader.manifest.sites.length > 1 && !(await isPlatformOperator(req.session!.userId))) {
      res.status(403).json({ error: "Only a platform operator can restore a network that creates subsites" });
      return;
    }
    const running = await runningBackupJob(null, ["restore", "network-restore"]);
    if (running) {
      res.status(409).json({ error: "A restore is already running", jobId: running.id });
      return;
    }
    const siteId = req.session!.siteId;
    const sourceRoot = reader.manifest.source.siteId;
    const jobId = await startBackupJob({ siteId, kind: "network-restore", scope: "network", message: "Checking the backup" }, async (job) => {
      try {
        const result = await restoreNetwork({
          rootSiteId: siteId,
          actorId: req.session!.userId,
          reader,
          plan,
          signal: job.signal,
          progress: (completed, total, message) => job.progress((completed / total) * 100, message),
          onSiteCreated: (created) => job.recordCreatedSite(created),
          onSnapshot: (snapshot) => saveRollbackSnapshot(job.jobId, siteId, snapshot),
        });
        auditFromRequest(req, "backup.network_restored", { target: siteId, detail: `source=${sourceRoot}; sites=${result.sites.length}` });
        return { result };
      } catch (error) {
        auditFromRequest(req, "backup.network_restored", { target: siteId, outcome: "failure", detail: `source=${sourceRoot}` });
        throw error;
      }
    });
    res.status(202).json({ jobId });
  },
);

export default router;
