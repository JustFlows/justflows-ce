// SPDX-License-Identifier: MIT

// Shared state for a core update run.
//
// A core update copies files, runs migrations and `pnpm install`, then restarts
// the app. That work must not run inside the HTTP request that starts it — the
// single Passenger worker would block for minutes and the browser would be left
// with a request that never resolves. Instead the request stages the upload,
// records a job here, and spawns a detached worker (see `core-update-worker.ts`).
//
// This module is imported by both sides (the web process and the detached
// worker), so it stays dependency-free: just the filesystem under `.updates/`.

import fs from "node:fs";
import path from "node:path";
import { getJfRoot } from "./jf-root.js";

export interface UpdateStep {
  step: string;
  ok: boolean;
  detail?: string;
}

export type UpdatePhase =
  | "queued"
  | "downloading"
  | "verifying"
  | "extracting"
  | "validating"
  | "copying"
  | "migrating"
  | "installing"
  | "building"
  | "restarting"
  | "done"
  | "failed";

export interface UpdateStatus {
  /** True while a worker (or the compatibility foreground path) owns the job. */
  running: boolean;
  phase: UpdatePhase;
  source: "upload" | "remote" | "auto" | null;
  pid: number | null;
  startedAt: number | null;
  updatedAt: number;
  finishedAt: number | null;
  currentVersion: string | null;
  targetVersion: string | null;
  newVersion: string | null;
  ok: boolean | null;
  error: string | null;
  restartRequired: boolean;
  restarting: boolean;
  steps: UpdateStep[];
  log: string[];
}

export interface UpdateJob {
  source: "upload" | "remote" | "auto";
  siteId: string | null;
  createdAt: number;
  currentVersion: string;
  targetVersion: string | null;
  /** Absolute path to the staged zip (upload path; also filled by the worker). */
  zipPath: string | null;
  /** Optional HMAC signature supplied with an operator upload. */
  signature: string | null;
  /** Remote download descriptor (remote path). */
  release: {
    availableVersion: string;
    downloadUrl: string;
    sha256Url: string | null;
  } | null;
  /**
   * When set, the worker skips extraction and treats this directory as the
   * already-unpacked archive. Used so the very first upgrade to a build that
   * ships the worker can still run in the background.
   */
  preExtractedDir: string | null;
}

/** A run with no heartbeat for this long is treated as dead and cleared. */
export const STALE_AFTER_MS = 20 * 60 * 1000;

export function updatesDir(): string {
  return path.join(getJfRoot(), ".updates");
}
export function stagingDir(): string {
  return path.join(updatesDir(), "staging");
}
function statusPath(): string {
  return path.join(updatesDir(), "status.json");
}
function jobPath(): string {
  return path.join(updatesDir(), "job.json");
}
function lockPath(): string {
  return path.join(updatesDir(), "lock");
}

function ensureDir(): void {
  fs.mkdirSync(updatesDir(), { recursive: true });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH: no such process. EPERM: exists but not ours — still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function idleStatus(): UpdateStatus {
  return {
    running: false,
    phase: "done",
    source: null,
    pid: null,
    startedAt: null,
    updatedAt: 0,
    finishedAt: null,
    currentVersion: null,
    targetVersion: null,
    newVersion: null,
    ok: null,
    error: null,
    restartRequired: false,
    restarting: false,
    steps: [],
    log: [],
  };
}

function writeStatusFile(status: UpdateStatus): void {
  ensureDir();
  const tmp = statusPath() + `.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(status, null, 2));
  fs.renameSync(tmp, statusPath());
}

/**
 * Current status, with a self-healing step: if a run claims to be `running` but
 * its worker is gone (crash, OOM kill, Passenger recycle) or it has been silent
 * past {@link STALE_AFTER_MS}, mark it failed and drop the lock so the operator
 * can try again instead of staring at a dead spinner.
 */
export function readUpdateStatus(): UpdateStatus {
  let status: UpdateStatus;
  try {
    status = {
      ...idleStatus(),
      ...(JSON.parse(fs.readFileSync(statusPath(), "utf-8")) as UpdateStatus),
    };
  } catch {
    return idleStatus();
  }

  if (!status.running) return status;

  const silentFor = Date.now() - (status.updatedAt || status.startedAt || 0);
  const workerGone = status.pid != null && !isProcessAlive(status.pid);
  if (workerGone || silentFor > STALE_AFTER_MS) {
    const healed: UpdateStatus = {
      ...status,
      running: false,
      phase: "failed",
      ok: false,
      finishedAt: Date.now(),
      updatedAt: Date.now(),
      error: workerGone
        ? "The update process exited unexpectedly (it may have run out of memory). No files were left half-written that a re-run cannot fix."
        : "The update stopped reporting progress and was marked as failed.",
      log: [...status.log, "✗ Update process ended without finishing"],
    };
    try {
      writeStatusFile(healed);
      clearLock();
    } catch {
      /* best effort */
    }
    return healed;
  }

  return status;
}

export function initUpdateStatus(input: {
  source: "upload" | "remote" | "auto";
  currentVersion: string;
  targetVersion: string | null;
}): void {
  const now = Date.now();
  writeStatusFile({
    ...idleStatus(),
    running: true,
    phase: "queued",
    source: input.source,
    pid: null,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    currentVersion: input.currentVersion,
    targetVersion: input.targetVersion,
    ok: null,
    log: ["↻ Update queued…"],
  });
}

export function patchUpdateStatus(patch: Partial<UpdateStatus>): UpdateStatus {
  const current = (() => {
    try {
      return {
        ...idleStatus(),
        ...(JSON.parse(fs.readFileSync(statusPath(), "utf-8")) as UpdateStatus),
      };
    } catch {
      return idleStatus();
    }
  })();
  const next: UpdateStatus = { ...current, ...patch, updatedAt: Date.now() };
  writeStatusFile(next);
  return next;
}

export function appendUpdateLog(line: string): void {
  const current = readUpdateStatusRaw();
  patchUpdateStatus({ log: [...current.log, line] });
}

function readUpdateStatusRaw(): UpdateStatus {
  try {
    return {
      ...idleStatus(),
      ...(JSON.parse(fs.readFileSync(statusPath(), "utf-8")) as UpdateStatus),
    };
  } catch {
    return idleStatus();
  }
}

// --- lock -------------------------------------------------------------------

interface LockFile {
  pid: number;
  source: string;
  startedAt: number;
}

/**
 * Reserve the update slot. Returns false when another run holds it — unless that
 * run is demonstrably dead, in which case its lock is stolen.
 */
export function acquireLock(source: string): boolean {
  ensureDir();
  const payload = JSON.stringify({
    pid: process.pid,
    source,
    startedAt: Date.now(),
  } satisfies LockFile);
  try {
    fs.writeFileSync(lockPath(), payload, { flag: "wx" });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }

  let held: LockFile | null = null;
  try {
    held = JSON.parse(fs.readFileSync(lockPath(), "utf-8")) as LockFile;
  } catch {
    held = null;
  }

  const dead =
    !held ||
    (held.pid !== process.pid && !isProcessAlive(held.pid)) ||
    Date.now() - held.startedAt > STALE_AFTER_MS;

  if (dead) {
    try {
      fs.writeFileSync(lockPath(), payload);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function clearLock(): void {
  try {
    fs.rmSync(lockPath(), { force: true });
  } catch {
    /* best effort */
  }
}

export function isUpdateRunning(): boolean {
  return readUpdateStatus().running;
}

// --- job descriptor -------------------------------------------------------

export function writeUpdateJob(job: UpdateJob): void {
  ensureDir();
  fs.writeFileSync(jobPath(), JSON.stringify(job, null, 2));
}

export function readUpdateJob(): UpdateJob | null {
  try {
    return JSON.parse(fs.readFileSync(jobPath(), "utf-8")) as UpdateJob;
  } catch {
    return null;
  }
}

export function clearUpdateJob(): void {
  try {
    fs.rmSync(jobPath(), { force: true });
  } catch {
    /* best effort */
  }
}
