// SPDX-License-Identifier: MIT

import type { DbClient } from "../database/db.js";

/**
 * Rows of `job_queue` (migration `0048_job_queue`), in the control database.
 * Every state change is a conditional update, so two workers never both run
 * a row: claiming needs `status = 'queued'`, and only the worker named in
 * `locked_by` may extend, finish, or fail a running row.
 */

export type JobQueueStatus = "queued" | "running" | "done" | "failed";

export interface JobQueueRow {
  id: string;
  jobName: string;
  siteId: string | null;
  payload: unknown;
  status: JobQueueStatus;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  lockedBy: string | null;
  lockedUntil: Date | null;
  lastError: string | null;
  createdAt: Date | null;
  finishedAt: Date | null;
}

type Db = Pick<DbClient, "run" | "query" | "execute">;

/** Largest stored payload; a bigger one is refused at enqueue. */
export const MAX_JOB_PAYLOAD_BYTES = 1024 * 1024;
const MAX_ERROR_CHARS = 2000;
export const DONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const FAILED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const INTERRUPTED_ERROR = "Interrupted: the process running it stopped before it finished.";

/** UTC `YYYY-MM-DD HH:MM:SS.mmm`, read as UTC by both database clients. */
export function sqlTime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

function toDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  const iso = text.includes("T") ? text : text.replace(" ", "T");
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return value.toString("utf8");
  return String(value);
}

function readPayload(value: unknown): unknown {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function rowFromDb(row: Record<string, unknown>): JobQueueRow {
  const status = text(row.status);
  return {
    id: text(row.id),
    jobName: text(row.job_name),
    siteId: row.site_id == null || row.site_id === "" ? null : text(row.site_id),
    payload: readPayload(row.payload),
    status: (["queued", "running", "done", "failed"].includes(status) ? status : "queued") as JobQueueStatus,
    attempts: Number(row.attempts) || 0,
    maxAttempts: Number(row.max_attempts) || 1,
    runAt: toDate(row.run_at) ?? new Date(0),
    lockedBy: row.locked_by == null ? null : text(row.locked_by),
    lockedUntil: toDate(row.locked_until),
    lastError: row.last_error == null ? null : text(row.last_error),
    createdAt: toDate(row.created_at),
    finishedAt: toDate(row.finished_at),
  };
}

export function encodePayload(payload: unknown): string | null {
  if (payload === undefined) return null;
  const json = JSON.stringify(payload);
  if (json === undefined) return null;
  if (Buffer.byteLength(json, "utf8") > MAX_JOB_PAYLOAD_BYTES) {
    throw new Error(`A job payload may be at most ${MAX_JOB_PAYLOAD_BYTES} bytes as JSON.`);
  }
  return json;
}

export async function jobQueueAvailable(db: Pick<DbClient, "query">): Promise<boolean> {
  try {
    await db.query("SELECT id FROM job_queue WHERE 1 = 0");
    return true;
  } catch {
    return false;
  }
}

export async function insertJob(
  db: Db,
  job: { id: string; jobName: string; siteId: string | null; payload: string | null; maxAttempts: number; runAtMs: number; nowMs: number },
): Promise<void> {
  await db.run(
    `INSERT INTO job_queue (id, job_name, site_id, payload, status, attempts, max_attempts, run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?)`,
    [job.id, job.jobName, job.siteId, job.payload, job.maxAttempts, sqlTime(job.runAtMs), sqlTime(job.nowMs), sqlTime(job.nowMs)],
  );
}

/** Queued rows of these jobs that are due, oldest first. */
export async function dueJobs(db: Db, names: string[], nowMs: number, limit: number): Promise<JobQueueRow[]> {
  if (names.length === 0 || limit <= 0) return [];
  const take = Math.min(100, Math.max(1, Math.trunc(limit)));
  const marks = names.map(() => "?").join(", ");
  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM job_queue WHERE status = 'queued' AND run_at <= ? AND job_name IN (${marks}) ORDER BY run_at, id LIMIT ${take}`,
    [sqlTime(nowMs), ...names],
  );
  return rows.map(rowFromDb);
}

/** Take a due row for this worker. False when another worker took it first. */
export async function claimJob(db: Db, id: string, worker: string, nowMs: number, leaseMs: number): Promise<boolean> {
  const changed = await db.execute(
    `UPDATE job_queue SET status = 'running', locked_by = ?, locked_until = ?, attempts = attempts + 1, updated_at = ?
     WHERE id = ? AND status = 'queued' AND run_at <= ?`,
    [worker, sqlTime(nowMs + leaseMs), sqlTime(nowMs), id, sqlTime(nowMs)],
  );
  return changed > 0;
}

/** Keep a running row's lease. False when this worker no longer holds it. */
export async function extendLease(db: Db, id: string, worker: string, nowMs: number, leaseMs: number): Promise<boolean> {
  const changed = await db.execute(
    "UPDATE job_queue SET locked_until = ?, updated_at = ? WHERE id = ? AND status = 'running' AND locked_by = ?",
    [sqlTime(nowMs + leaseMs), sqlTime(nowMs), id, worker],
  );
  return changed > 0;
}

export async function completeJob(db: Db, id: string, worker: string, nowMs: number): Promise<boolean> {
  const changed = await db.execute(
    `UPDATE job_queue SET status = 'done', locked_by = NULL, locked_until = NULL, last_error = NULL, finished_at = ?, updated_at = ?
     WHERE id = ? AND status = 'running' AND locked_by = ?`,
    [sqlTime(nowMs), sqlTime(nowMs), id, worker],
  );
  return changed > 0;
}

/** Record a failed attempt: queued again at `retryAtMs`, or failed for good when it is null. */
export async function failJob(db: Db, id: string, worker: string, error: string, nowMs: number, retryAtMs: number | null): Promise<boolean> {
  const message = error.slice(0, MAX_ERROR_CHARS);
  const changed = retryAtMs === null
    ? await db.execute(
      `UPDATE job_queue SET status = 'failed', locked_by = NULL, locked_until = NULL, last_error = ?, finished_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running' AND locked_by = ?`,
      [message, sqlTime(nowMs), sqlTime(nowMs), id, worker],
    )
    : await db.execute(
      `UPDATE job_queue SET status = 'queued', locked_by = NULL, locked_until = NULL, last_error = ?, run_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running' AND locked_by = ?`,
      [message, sqlTime(retryAtMs), sqlTime(nowMs), id, worker],
    );
  return changed > 0;
}

/**
 * Rows whose lease ran out: the process running them stopped. Each counts as
 * a failed attempt: queued again, or failed when it has no attempts left.
 */
export async function recoverExpiredJobs(db: Db, nowMs: number): Promise<{ requeued: number; failed: number }> {
  const now = sqlTime(nowMs);
  const failed = await db.execute(
    `UPDATE job_queue SET status = 'failed', locked_by = NULL, locked_until = NULL, last_error = ?, finished_at = ?, updated_at = ?
     WHERE status = 'running' AND locked_until < ? AND attempts >= max_attempts`,
    [INTERRUPTED_ERROR, now, now, now],
  );
  const requeued = await db.execute(
    `UPDATE job_queue SET status = 'queued', locked_by = NULL, locked_until = NULL, last_error = ?, run_at = ?, updated_at = ?
     WHERE status = 'running' AND locked_until < ?`,
    [INTERRUPTED_ERROR, now, now, now],
  );
  return { requeued, failed };
}

export async function pruneJobs(db: Db, nowMs: number): Promise<number> {
  const done = await db.execute(
    "DELETE FROM job_queue WHERE status = 'done' AND finished_at < ?",
    [sqlTime(nowMs - DONE_RETENTION_MS)],
  );
  const failed = await db.execute(
    "DELETE FROM job_queue WHERE status = 'failed' AND finished_at < ?",
    [sqlTime(nowMs - FAILED_RETENTION_MS)],
  );
  return done + failed;
}

/** Run a failed row again, with its attempts reset. */
export async function retryFailedJob(db: Db, id: string, nowMs: number): Promise<boolean> {
  const changed = await db.execute(
    `UPDATE job_queue SET status = 'queued', attempts = 0, run_at = ?, finished_at = NULL, updated_at = ?
     WHERE id = ? AND status = 'failed'`,
    [sqlTime(nowMs), sqlTime(nowMs), id],
  );
  return changed > 0;
}

export async function countJobs(db: Db): Promise<Record<JobQueueStatus, number>> {
  const counts: Record<JobQueueStatus, number> = { queued: 0, running: 0, done: 0, failed: 0 };
  const rows = await db.query<Record<string, unknown>>("SELECT status, COUNT(*) AS total FROM job_queue GROUP BY status");
  for (const row of rows) {
    const status = text(row.status) as JobQueueStatus;
    if (status in counts) counts[status] = Number(row.total ?? row.TOTAL) || 0;
  }
  return counts;
}

/** Unfinished and failed rows, newest first, for diagnostics. Payloads are left out. */
export async function listOpenJobs(db: Db, limit = 50): Promise<Array<Omit<JobQueueRow, "payload">>> {
  const take = Math.min(200, Math.max(1, Math.trunc(limit)));
  const rows = await db.query<Record<string, unknown>>(
    `SELECT id, job_name, site_id, status, attempts, max_attempts, run_at, locked_by, locked_until, last_error, created_at, finished_at
     FROM job_queue WHERE status IN ('queued', 'running', 'failed') ORDER BY updated_at DESC, id LIMIT ${take}`,
  );
  return rows.map((row) => {
    const { payload: _payload, ...rest } = rowFromDb(row);
    return rest;
  });
}
