// SPDX-License-Identifier: MIT

import type { DbClient } from "../database/db.js";
import { getControlDb } from "../database/db.js";
import { registerCoreJob } from "../jobs/core-jobs.js";
import { sqlTime, type JobQueueRow } from "../jobs/job-queue-db.js";
import { getDurableJobQueue } from "../plugins/plugin-jobs.js";
import { getJustflowsVersion } from "../runtime/version.js";
import { installationRootSiteId } from "../tenancy/registry.js";
import { deliverBackup, type BackupDestination } from "./destinations.js";
import { buildSiteBackup, buildSubsiteBackups, type BackupArtifact } from "./workspace-backup.js";

export const AUTOMATIC_BACKUP_JOB = "backup.automatic";
const AUTOMATIC_BACKUP_SCAN_JOB = "backup.schedule-scan";
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type BackupFrequency = "daily" | "weekly" | "monthly";
export type BackupScheduleScope = "root" | "subsites" | "all";

export interface BackupScheduleInput {
  enabled: boolean;
  frequency: BackupFrequency;
  timeUtc: string;
  weekday: number;
  dayOfMonth: number;
  scope: BackupScheduleScope;
  destination: BackupDestination;
}

export interface BackupScheduleState extends BackupScheduleInput {
  nextRunAt: string | null;
  lastJobId: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
}

interface ScheduleRow {
  site_id: string;
  enabled: boolean | number;
  frequency: string;
  time_utc: string;
  weekday: number;
  day_of_month: number;
  scope: string;
  destination: string;
  next_run_at: Date | string | null;
  last_job_id: string | null;
  last_started_at: Date | string | null;
  last_finished_at: Date | string | null;
  last_status: string | null;
  last_error: string | null;
}

const defaults = (): BackupScheduleState => ({
  enabled: false,
  frequency: "daily",
  timeUtc: "02:00",
  weekday: 1,
  dayOfMonth: 1,
  scope: "all",
  destination: "s3",
  nextRunAt: null,
  lastJobId: null,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastStatus: null,
  lastError: null,
});

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value).replace(" ", "T") + (String(value).includes("Z") ? "" : "Z"));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function state(row?: ScheduleRow): BackupScheduleState {
  if (!row) return defaults();
  return {
    enabled: row.enabled === true || Number(row.enabled) === 1,
    frequency: row.frequency === "weekly" || row.frequency === "monthly" ? row.frequency : "daily",
    timeUtc: TIME.test(row.time_utc) ? row.time_utc : "02:00",
    weekday: Math.min(6, Math.max(0, Number(row.weekday) || 0)),
    dayOfMonth: Math.min(31, Math.max(1, Number(row.day_of_month) || 1)),
    scope: row.scope === "root" || row.scope === "subsites" ? row.scope : "all",
    destination: row.destination === "ftp" || row.destination === "email" ? row.destination : "s3",
    nextRunAt: iso(row.next_run_at),
    lastJobId: row.last_job_id ? String(row.last_job_id) : null,
    lastStartedAt: iso(row.last_started_at),
    lastFinishedAt: iso(row.last_finished_at),
    lastStatus: row.last_status ? String(row.last_status) : null,
    lastError: row.last_error ? String(row.last_error) : null,
  };
}

export function nextBackupRun(input: BackupScheduleInput, after = new Date()): Date {
  const match = TIME.exec(input.timeUtc);
  if (!match) throw new Error("Backup time must use HH:mm UTC");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  for (let offset = 0; offset < 370; offset += 1) {
    const day = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate() + offset, hour, minute));
    if (day.getTime() <= after.getTime()) continue;
    if (input.frequency === "weekly" && day.getUTCDay() !== input.weekday) continue;
    if (input.frequency === "monthly") {
      const last = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
      if (day.getUTCDate() !== Math.min(input.dayOfMonth, last)) continue;
    }
    return day;
  }
  throw new Error("Could not calculate the next automatic backup");
}

async function rowForSite(db: Pick<DbClient, "query">, siteId: string): Promise<ScheduleRow | undefined> {
  return (await db.query<ScheduleRow>("SELECT * FROM backup_schedules WHERE site_id = ? LIMIT 1", [siteId]))[0];
}

export async function backupScheduleSettings(siteId: string): Promise<BackupScheduleState> {
  return state(await rowForSite(await getControlDb(), siteId));
}

export async function saveBackupSchedule(siteId: string, input: BackupScheduleInput): Promise<BackupScheduleState> {
  if (!TIME.test(input.timeUtc)) throw new Error("Backup time must use HH:mm UTC");
  const db = await getControlDb();
  const next = input.enabled ? nextBackupRun(input) : null;
  const stamp = new Date();
  const values: Array<string | number | boolean | null> = [
    input.enabled,
    input.frequency,
    input.timeUtc,
    input.weekday,
    input.dayOfMonth,
    input.scope,
    input.destination,
    next ? sqlTime(next.getTime()) : null,
    sqlTime(stamp.getTime()),
    siteId,
  ];
  const changed = await db.execute(
    `UPDATE backup_schedules SET enabled = ?, frequency = ?, time_utc = ?, weekday = ?, day_of_month = ?,
       scope = ?, destination = ?, next_run_at = ?, updated_at = ? WHERE site_id = ?`,
    values,
  );
  if (changed === 0) {
    await db.run(
      `INSERT INTO backup_schedules
       (site_id, enabled, frequency, time_utc, weekday, day_of_month, scope, destination, next_run_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [siteId, ...values.slice(0, 9)],
    );
  }
  return backupScheduleSettings(siteId);
}

async function artifactsForRun(siteId: string, settings: BackupScheduleInput): Promise<BackupArtifact[]> {
  const createdAt = new Date().toISOString();
  const driver = (process.env.DB_DRIVER ?? "postgres") as "postgres" | "mysql" | "mariadb";
  const artifacts: BackupArtifact[] = [];
  if (settings.scope === "root" || settings.scope === "all") {
    artifacts.push(await buildSiteBackup(siteId, createdAt, driver, getJustflowsVersion()));
  }
  if (settings.scope === "subsites" || settings.scope === "all") {
    const subsites = await buildSubsiteBackups(siteId, createdAt, driver, getJustflowsVersion()).catch((error) => {
      if (error instanceof Error && error.message === "This workspace has no subsites to back up" && settings.scope === "all") return [];
      throw error;
    });
    artifacts.push(...subsites);
  }
  return artifacts;
}

async function runAutomaticBackup(row: JobQueueRow) {
  const payload = row.payload as Partial<BackupScheduleInput> | undefined;
  const siteId = row.siteId;
  if (!siteId || !payload) return { success: false, message: "Automatic backup job has no site or schedule" };
  const settings = state({
    site_id: siteId,
    enabled: true,
    frequency: String(payload.frequency ?? "daily"),
    time_utc: String(payload.timeUtc ?? "02:00"),
    weekday: Number(payload.weekday ?? 1),
    day_of_month: Number(payload.dayOfMonth ?? 1),
    scope: String(payload.scope ?? "all"),
    destination: String(payload.destination ?? "s3"),
    next_run_at: null,
    last_job_id: row.id,
    last_started_at: null,
    last_finished_at: null,
    last_status: null,
    last_error: null,
  });
  const db = await getControlDb();
  await db.run(
    "UPDATE backup_schedules SET last_started_at = ?, last_status = 'running', last_error = NULL, updated_at = ? WHERE site_id = ?",
    [sqlTime(Date.now()), sqlTime(Date.now()), siteId],
  );
  try {
    const artifacts = await artifactsForRun(siteId, settings);
    for (const artifact of artifacts) {
      await deliverBackup(siteId, settings.destination, artifact.filename, artifact.archive);
    }
    await db.run(
      "UPDATE backup_schedules SET last_finished_at = ?, last_status = 'done', last_error = NULL, updated_at = ? WHERE site_id = ?",
      [sqlTime(Date.now()), sqlTime(Date.now()), siteId],
    );
    return { success: true, message: `${artifacts.length} backup file${artifacts.length === 1 ? "" : "s"} delivered` };
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Automatic backup failed").slice(0, 2000);
    await db.run(
      "UPDATE backup_schedules SET last_finished_at = ?, last_status = 'failed', last_error = ?, updated_at = ? WHERE site_id = ?",
      [sqlTime(Date.now()), message, sqlTime(Date.now()), siteId],
    );
    return { success: false, message };
  }
}

export async function enqueueAutomaticBackup(siteId: string, input?: BackupScheduleInput): Promise<string> {
  const settings = input ?? (await backupScheduleSettings(siteId));
  return getDurableJobQueue().enqueue(AUTOMATIC_BACKUP_JOB, {
    siteId,
    payload: settings,
    maxAttempts: 3,
  });
}

async function scanDueBackups(): Promise<{ success: boolean; message: string }> {
  const db = await getControlDb();
  const now = Date.now();
  const due = await db.query<ScheduleRow>(
    "SELECT * FROM backup_schedules WHERE enabled = ? AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT 20",
    [true, sqlTime(now)],
  );
  let queued = 0;
  for (const row of due) {
    const settings = state(row);
    const next = nextBackupRun(settings, new Date(now));
    const claimed = await db.execute(
      "UPDATE backup_schedules SET next_run_at = ?, updated_at = ? WHERE site_id = ? AND enabled = ? AND next_run_at <= ?",
      [sqlTime(next.getTime()), sqlTime(now), row.site_id, true, sqlTime(now)],
    );
    if (claimed === 0) continue;
    try {
      const id = await enqueueAutomaticBackup(row.site_id, settings);
      await db.run(
        "UPDATE backup_schedules SET last_job_id = ?, last_status = 'queued', last_error = NULL, updated_at = ? WHERE site_id = ?",
        [id, sqlTime(Date.now()), row.site_id],
      );
      queued += 1;
    } catch (error) {
      await db.run(
        "UPDATE backup_schedules SET last_status = 'failed', last_error = ?, updated_at = ? WHERE site_id = ?",
        [(error instanceof Error ? error.message : "Could not enqueue automatic backup").slice(0, 2000), sqlTime(Date.now()), row.site_id],
      );
    }
  }
  return { success: true, message: `${queued} automatic backup${queued === 1 ? "" : "s"} queued` };
}

let started = false;

export function startScheduledBackupJobs(): void {
  if (started) return;
  started = true;
  getDurableJobQueue().register(AUTOMATIC_BACKUP_JOB, { maxAttempts: 3, run: runAutomaticBackup });
  registerCoreJob({ name: AUTOMATIC_BACKUP_SCAN_JOB, schedule: "* * * * *", handler: scanDueBackups });
}

export async function automaticBackupHealth(): Promise<BackupScheduleState & { siteId: string | null }> {
  const db = await getControlDb();
  const siteId = await installationRootSiteId(db).catch(() => null);
  if (!siteId) return { ...defaults(), siteId: null };
  return { ...(await backupScheduleSettings(siteId)), siteId };
}
