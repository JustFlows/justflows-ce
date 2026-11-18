// SPDX-License-Identifier: MIT

import { randomBytes, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { gzipSync, gunzipSync } from "node:zlib";
import { getControlDb } from "../database/db.js";
import { sqlTime } from "../jobs/job-queue-db.js";
import { decryptSecret, encryptSecret } from "../security/secret-box.js";
import { openBackup, sealBackup } from "./archive-crypto.js";
import type { PortableBackupEnvelope } from "./portable-archive.js";
import type { BackupArtifact } from "./workspace-backup.js";

export type BackupJobKind = "backup" | "restore" | "network-restore";
export type BackupJobStatus = "running" | "ready" | "done" | "failed" | "cancelled";

export interface BackupJobFile {
  index: number;
  siteId: string;
  siteName: string;
  filename: string;
  size: number;
  storageId: string;
  object: string;
}

export interface BackupJob {
  id: string;
  siteId: string;
  kind: BackupJobKind;
  scope: string;
  status: BackupJobStatus;
  progress: number;
  message: string;
  error: string | null;
  result: unknown;
  files: BackupJobFile[];
  createdSites: string[];
  updatedAt: number;
  heartbeatAt: number;
}

const OWNER = "core.backups";
const HEARTBEAT_MS = 5_000;
const CANCEL_POLL_MS = 2_000;
/** A running job whose worker has not reported for this long has stopped. */
export const STALE_AFTER_MS = 90_000;
/** Finished jobs and their files are removed after this long. */
const RETAIN_MS = 6 * 60 * 60 * 1000;
const WORKER = `${hostname()}:${process.pid}`;

function time(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const text = String(value ?? "");
  const parsed = Date.parse(text.includes("T") ? text : `${text.replace(" ", "T")}Z`);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function fromRow(row: Record<string, unknown>): BackupJob {
  return {
    id: String(row.id),
    siteId: String(row.site_id),
    kind: String(row.kind) as BackupJobKind,
    scope: String(row.scope ?? "site"),
    status: String(row.status) as BackupJobStatus,
    progress: Number(row.progress) || 0,
    message: String(row.message ?? ""),
    error: row.error ? String(row.error) : null,
    result: json(row.result_json, null),
    files: json<BackupJobFile[]>(row.files_json, []),
    createdSites: json<string[]>(row.created_sites_json, []),
    updatedAt: time(row.updated_at),
    heartbeatAt: time(row.heartbeat_at),
  };
}

async function patch(id: string, values: Record<string, string | number | boolean | null>): Promise<void> {
  const columns = Object.keys(values);
  const now = sqlTime(Date.now());
  await (await getControlDb()).run(
    `UPDATE backup_jobs SET ${columns.map((column) => `${column} = ?`).join(", ")}, updated_at = ?, heartbeat_at = ? WHERE id = ?`,
    [...columns.map((column) => values[column]!), now, now, id],
  );
}

export async function getBackupJob(id: string, siteId: string): Promise<BackupJob | null> {
  const rows = await (await getControlDb()).query<Record<string, unknown>>("SELECT * FROM backup_jobs WHERE id = ? AND site_id = ? LIMIT 1", [id, siteId]);
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function runningBackupJob(siteId: string | null, kinds: BackupJobKind[]): Promise<BackupJob | null> {
  const rows = await (await getControlDb()).query<Record<string, unknown>>(
    `SELECT * FROM backup_jobs WHERE status = 'running' AND kind IN (${kinds.map(() => "?").join(", ")})${siteId ? " AND site_id = ?" : ""} ORDER BY created_at DESC LIMIT 1`,
    siteId ? [...kinds, siteId] : kinds,
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function requestBackupJobCancel(id: string, siteId: string): Promise<boolean> {
  const changed = await (await getControlDb()).execute(
    "UPDATE backup_jobs SET cancel_requested = ? WHERE id = ? AND site_id = ? AND status = 'running'",
    [true, id, siteId],
  );
  return changed > 0;
}

async function privateBackend(siteId: string) {
  const { activePrivateBackend, objectKey } = await import("../files/private-storage.js");
  return { backend: await activePrivateBackend(siteId), objectKey };
}

/** Keep finished backup files in private storage, where every worker can read them. */
async function storeArtifacts(job: { id: string; siteId: string }, artifacts: BackupArtifact[]): Promise<BackupJobFile[]> {
  const { backend, objectKey } = await privateBackend(job.siteId);
  const files: BackupJobFile[] = [];
  for (const [index, artifact] of artifacts.entries()) {
    const object = objectKey(job.siteId, OWNER, `${job.id}/${index}.jfbackup`);
    await backend.put(object, artifact.archive, "application/vnd.justflows.backup");
    files.push({ index, siteId: artifact.siteId, siteName: artifact.siteName, filename: artifact.filename, size: artifact.archive.byteLength, storageId: backend.id, object });
  }
  return files;
}

export async function readBackupJobFile(job: BackupJob, file: BackupJobFile): Promise<Buffer | null> {
  const { privateBackendById } = await import("../files/private-storage.js");
  const backend = await privateBackendById(job.siteId, file.storageId);
  return (await backend?.read(file.object)) ?? null;
}

async function deleteFiles(siteId: string, files: Array<{ storageId: string; object: string }>): Promise<void> {
  const { localPrivateBackend, privateBackendById, privateLocalRoot } = await import("../files/private-storage.js");
  const local = localPrivateBackend(privateLocalRoot());
  for (const file of files) {
    const backend = file.storageId === local.id ? local : await privateBackendById(siteId, file.storageId);
    await backend?.delete(file.object).catch(() => undefined);
  }
}

/** Delete a job's files and mark it cancelled when it is still running. */
export async function discardBackupJob(job: BackupJob): Promise<void> {
  await deleteFiles(job.siteId, job.files);
  if (job.status === "running") await requestBackupJobCancel(job.id, job.siteId);
  else await (await getControlDb()).run("DELETE FROM backup_jobs WHERE id = ?", [job.id]);
}

/**
 * Store the pre-restore snapshot outside this process, encrypted with a
 * one-time passphrase kept under the installation secret, so another worker
 * can still put the site back if this one stops mid-restore.
 */
export async function saveRollbackSnapshot(jobId: string, siteId: string, snapshot: PortableBackupEnvelope): Promise<void> {
  const passphrase = randomBytes(24).toString("base64url");
  const sealed = sealBackup(gzipSync(Buffer.from(JSON.stringify(snapshot))), passphrase, { kind: "site", createdAt: snapshot.createdAt, siteName: snapshot.source.siteName });
  const { localPrivateBackend, objectKey, privateLocalRoot } = await import("../files/private-storage.js");
  const backend = localPrivateBackend(privateLocalRoot());
  const object = objectKey(siteId, OWNER, `${jobId}/rollback.jfbackup`);
  await backend.put(object, sealed, "application/vnd.justflows.backup");
  await patch(jobId, { rollback_json: JSON.stringify({ storageId: backend.id, object, key: encryptSecret(passphrase) }) });
}

async function loadRollbackSnapshot(siteId: string, value: unknown): Promise<{ snapshot: PortableBackupEnvelope; file: { storageId: string; object: string } } | null> {
  const saved = json<{ storageId: string; object: string; key: string } | null>(value, null);
  if (!saved) return null;
  const { localPrivateBackend, privateLocalRoot } = await import("../files/private-storage.js");
  const local = localPrivateBackend(privateLocalRoot());
  if (local.id !== saved.storageId) return null;
  const bytes = await local.read(saved.object);
  if (!bytes) return null;
  const { plaintext } = openBackup(bytes, decryptSecret(saved.key));
  return { snapshot: JSON.parse(gunzipSync(plaintext).toString("utf8")) as PortableBackupEnvelope, file: saved };
}

export interface JobContext {
  jobId: string;
  signal: AbortSignal;
  progress(percent: number, message: string): void;
  recordCreatedSite(siteId: string): Promise<void>;
}

/**
 * Run a job in this process while its state lives in the database. The worker
 * refreshes a heartbeat, and polls for a cancel request made on any worker.
 */
export async function startBackupJob(
  input: { siteId: string; kind: BackupJobKind; scope: string; message: string },
  work: (context: JobContext) => Promise<{ artifacts?: BackupArtifact[]; result?: unknown }>,
): Promise<string> {
  await cleanupBackupJobs();
  const id = randomUUID();
  const now = sqlTime(Date.now());
  await (await getControlDb()).run(
    `INSERT INTO backup_jobs (id, site_id, kind, scope, status, progress, message, cancel_requested, worker, heartbeat_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'running', 1, ?, ?, ?, ?, ?, ?)`,
    [id, input.siteId, input.kind, input.scope, input.message, false, WORKER, now, now, now],
  );
  const controller = new AbortController();
  let progress = 1;
  let message = input.message;
  let dirty = false;
  const created: string[] = [];
  const heartbeat = setInterval(() => {
    const values: Record<string, string | number | boolean | null> = dirty ? { progress, message: message.slice(0, 500) } : {};
    dirty = false;
    void patch(id, { ...values, worker: WORKER }).catch(() => undefined);
  }, HEARTBEAT_MS);
  const cancelPoll = setInterval(() => {
    void getControlDb()
      .then((db) => db.query<{ cancel_requested: boolean | number }>("SELECT cancel_requested FROM backup_jobs WHERE id = ? LIMIT 1", [id]))
      .then((rows) => {
        const flag = rows[0]?.cancel_requested;
        if (flag === true || Number(flag) === 1) controller.abort();
      })
      .catch(() => undefined);
  }, CANCEL_POLL_MS);
  heartbeat.unref?.();
  cancelPoll.unref?.();
  const context: JobContext = {
    jobId: id,
    signal: controller.signal,
    progress(percent, text) {
      progress = Math.max(1, Math.min(99, Math.round(percent)));
      message = text;
      dirty = true;
    },
    async recordCreatedSite(siteId) {
      created.push(siteId);
      await patch(id, { created_sites_json: JSON.stringify(created) });
    },
  };
  void work(context)
    .then(async (outcome) => {
      if (controller.signal.aborted) throw new Error("Cancelled");
      const files = outcome.artifacts ? await storeArtifacts({ id, siteId: input.siteId }, outcome.artifacts) : [];
      await patch(id, {
        status: outcome.artifacts ? "ready" : "done",
        progress: 100,
        message: outcome.artifacts ? "Backup ready" : "Restore finished",
        result_json: outcome.result === undefined ? null : JSON.stringify(outcome.result),
        files_json: JSON.stringify(files),
        error: null,
      });
    })
    .catch(async (error) => {
      const text = (error instanceof Error ? error.message : "The job failed").slice(0, 2000);
      await patch(id, { status: controller.signal.aborted ? "cancelled" : "failed", error: text, message: text.slice(0, 500) }).catch(() => undefined);
    })
    .finally(async () => {
      clearInterval(heartbeat);
      clearInterval(cancelPoll);
      const rows = await (await getControlDb()).query<Record<string, unknown>>("SELECT site_id, rollback_json FROM backup_jobs WHERE id = ? LIMIT 1", [id]).catch(() => []);
      const saved = json<{ storageId: string; object: string } | null>(rows[0]?.rollback_json, null);
      if (saved) {
        await deleteFiles(input.siteId, [saved]);
        await patch(id, { rollback_json: null }).catch(() => undefined);
      }
    });
  return id;
}

/**
 * Finish jobs whose worker stopped: a backup simply fails; an interrupted
 * restore removes the subsites it created and puts the target site back from
 * its stored snapshot. Then remove finished jobs past their retention.
 */
export async function cleanupBackupJobs(): Promise<void> {
  const db = await getControlDb();
  const stale = await db.query<Record<string, unknown>>(
    "SELECT * FROM backup_jobs WHERE status = 'running' AND heartbeat_at < ?",
    [sqlTime(Date.now() - STALE_AFTER_MS)],
  );
  for (const row of stale) {
    const claimed = await db.execute("UPDATE backup_jobs SET status = 'failed', worker = ? WHERE id = ? AND status = 'running'", [WORKER, String(row.id)]);
    if (claimed === 0) continue;
    const job = fromRow(row);
    let note = "Interrupted: the process running this job stopped.";
    if (job.kind !== "backup") {
      const { discardInterruptedSites, restoreRollbackSnapshot } = await import("./restore-backup.js");
      const sitesRemoved = await discardInterruptedSites(job.createdSites);
      const saved = await loadRollbackSnapshot(job.siteId, row.rollback_json).catch(() => null);
      const putBack = saved ? await restoreRollbackSnapshot(job.siteId, saved.snapshot) : false;
      if (saved) await deleteFiles(job.siteId, [saved.file]);
      note += sitesRemoved && putBack ? " The site was put back as it was." : " Rolling back was incomplete; restore a recent backup.";
    }
    await db.run("UPDATE backup_jobs SET error = ?, message = ?, rollback_json = NULL, updated_at = ? WHERE id = ?", [note, note.slice(0, 500), sqlTime(Date.now()), String(row.id)]);
  }
  const expired = await db.query<Record<string, unknown>>(
    "SELECT * FROM backup_jobs WHERE status <> 'running' AND updated_at < ?",
    [sqlTime(Date.now() - RETAIN_MS)],
  );
  for (const row of expired) {
    const job = fromRow(row);
    await deleteFiles(job.siteId, job.files);
    await db.run("DELETE FROM backup_jobs WHERE id = ?", [job.id]);
  }
}
