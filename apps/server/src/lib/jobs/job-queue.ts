// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { DbClient } from "../database/db.js";
import {
  claimJob,
  completeJob,
  dueJobs,
  encodePayload,
  extendLease,
  failJob,
  insertJob,
  jobQueueAvailable,
  pruneJobs,
  recoverExpiredJobs,
  type JobQueueRow,
} from "./job-queue-db.js";

/**
 * Durable one-shot jobs. `enqueue` stores a row in `job_queue`; every process
 * polls for due rows of the jobs it has registered, claims one with a
 * conditional update, and holds a lease that a heartbeat extends while the
 * handler runs. A run whose process dies is queued again once its lease
 * runs out, and counts as an attempt. A handler that throws or returns
 * `success: false` is retried after 1, 5, 25 and then every 60 minutes until
 * `maxAttempts`, then stays `failed` (diagnostics list it and can retry it).
 * So a handler may run more than once and must be safe to repeat.
 */

export interface QueuedJobResult {
  success: boolean;
  message?: string;
}

export interface QueuedJobHandler {
  maxAttempts: number;
  run(job: JobQueueRow): Promise<QueuedJobResult>;
}

export interface JobQueueOptions {
  db: () => Promise<Pick<DbClient, "run" | "query" | "execute">>;
  workerId?: string;
  pollMs?: number;
  leaseMs?: number;
  /** Rows one process runs at the same time. */
  concurrency?: number;
  now?: () => number;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

const PRUNE_EVERY_MS = 60 * 60 * 1000;
const RECHECK_TABLE_MS = 60 * 1000;

/** Wait before attempt `attempts + 1`: 1, 5, 25, then 60 minutes. */
export function retryDelayMs(attempts: number): number {
  return Math.min(60, 5 ** Math.max(0, attempts - 1)) * 60_000;
}

export class DurableJobQueue {
  private readonly handlers = new Map<string, QueuedJobHandler>();
  private readonly running = new Set<string>();
  private readonly workerId: string;
  private readonly pollMs: number;
  private readonly leaseMs: number;
  private readonly concurrency: number;
  private readonly now: () => number;
  private readonly logger: Pick<Console, "info" | "warn" | "error">;
  private poller: ReturnType<typeof setInterval> | null = null;
  private wake: ReturnType<typeof setTimeout> | null = null;
  private ticking: Promise<number> | null = null;
  private available: boolean | null = null;
  private availableCheckedAt = 0;
  private lastPrune = 0;

  constructor(private readonly options: JobQueueOptions) {
    this.workerId = (options.workerId ?? `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`).slice(0, 64);
    this.pollMs = options.pollMs ?? 5_000;
    this.leaseMs = options.leaseMs ?? 5 * 60_000;
    this.concurrency = Math.max(1, options.concurrency ?? 4);
    this.now = options.now ?? Date.now;
    this.logger = options.logger ?? console;
  }

  register(name: string, handler: QueuedJobHandler): void {
    this.handlers.set(name, handler);
  }

  unregister(name: string): void {
    this.handlers.delete(name);
  }

  /** Drop `prefix` and `prefix:*` handlers. Their queued rows wait until registered again. */
  unregisterPrefix(prefix: string): void {
    for (const name of [...this.handlers.keys()]) {
      if (name === prefix || name.startsWith(`${prefix}:`)) this.handlers.delete(name);
    }
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  /** Whether the `job_queue` table exists; rechecked a minute after a miss. */
  async isAvailable(): Promise<boolean> {
    if (this.available === true) return true;
    if (this.available === false && this.now() - this.availableCheckedAt < RECHECK_TABLE_MS) return false;
    this.availableCheckedAt = this.now();
    try {
      this.available = await jobQueueAvailable(await this.options.db());
    } catch {
      this.available = false;
    }
    return this.available;
  }

  /** Store one run. Resolves with its id once the row is written. */
  async enqueue(
    name: string,
    options: { delayMs?: number; payload?: unknown; siteId?: string | null; maxAttempts?: number } = {},
  ): Promise<string> {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`Job "${name}" is not registered`);
    const id = randomUUID();
    const nowMs = this.now();
    const delay = Math.max(0, options.delayMs ?? 0);
    await insertJob(await this.options.db(), {
      id,
      jobName: name,
      siteId: options.siteId ?? null,
      payload: encodePayload(options.payload),
      maxAttempts: Math.max(1, Math.trunc(options.maxAttempts ?? handler.maxAttempts)),
      runAtMs: nowMs + delay,
      nowMs,
    });
    this.wakeIn(delay);
    return id;
  }

  start(): void {
    if (this.poller) return;
    this.poller = setInterval(() => void this.tick(), this.pollMs);
    this.poller.unref?.();
    this.wakeIn(0);
  }

  stop(): void {
    if (this.poller) clearInterval(this.poller);
    if (this.wake) clearTimeout(this.wake);
    this.poller = null;
    this.wake = null;
  }

  isRunning(): boolean {
    return this.poller !== null;
  }

  /** Rows this process is running now. */
  activeCount(): number {
    return this.running.size;
  }

  private wakeIn(delayMs: number): void {
    if (!this.poller) return;
    if (this.wake) clearTimeout(this.wake);
    this.wake = setTimeout(() => {
      this.wake = null;
      void this.tick();
    }, Math.min(delayMs + 25, this.pollMs));
    this.wake.unref?.();
  }

  /**
   * One poll: give back expired leases, prune old rows hourly, then claim and
   * start due rows up to the free slots. Resolves with the number started;
   * the runs continue in the background (`idle()` waits for them).
   */
  tick(): Promise<number> {
    if (!this.ticking) {
      this.ticking = this.poll().finally(() => {
        this.ticking = null;
      });
    }
    return this.ticking;
  }

  private async poll(): Promise<number> {
    try {
      if (!(await this.isAvailable())) return 0;
      const db = await this.options.db();
      const nowMs = this.now();
      const recovered = await recoverExpiredJobs(db, nowMs);
      if (recovered.requeued + recovered.failed > 0) {
        this.logger.warn("[jobs] Interrupted runs found", { ...recovered });
      }
      if (nowMs - this.lastPrune >= PRUNE_EVERY_MS) {
        this.lastPrune = nowMs;
        await pruneJobs(db, nowMs);
      }
      const free = this.concurrency - this.running.size;
      if (free <= 0) return 0;
      const due = await dueJobs(db, [...this.handlers.keys()], nowMs, free * 2);
      let started = 0;
      for (const row of due) {
        if (started >= free) break;
        if (this.running.has(row.id)) continue;
        if (!(await claimJob(db, row.id, this.workerId, this.now(), this.leaseMs))) continue;
        started += 1;
        this.running.add(row.id);
        void this.runRow({ ...row, attempts: row.attempts + 1, status: "running", lockedBy: this.workerId });
      }
      return started;
    } catch (err) {
      this.logger.error("[jobs] Queue poll failed", { error: String(err) });
      return 0;
    }
  }

  private runs = new Set<Promise<void>>();

  /** Resolves when every run this process started has finished. */
  async idle(): Promise<void> {
    while (this.runs.size > 0) await Promise.allSettled([...this.runs]);
  }

  private runRow(row: JobQueueRow): Promise<void> {
    const run = this.execute(row).finally(() => {
      this.running.delete(row.id);
      this.runs.delete(run);
    });
    this.runs.add(run);
    return run;
  }

  private async execute(row: JobQueueRow): Promise<void> {
    const handler = this.handlers.get(row.jobName);
    const db = await this.options.db();
    const heartbeat = setInterval(() => {
      void extendLease(db, row.id, this.workerId, this.now(), this.leaseMs)
        .then((held) => {
          if (!held) this.logger.warn(`[jobs] "${row.jobName}" lost its lease`, { id: row.id });
        })
        .catch(() => undefined);
    }, Math.max(1_000, Math.floor(this.leaseMs / 3)));
    heartbeat.unref?.();
    let failure = "";
    try {
      if (!handler) throw new Error("No handler is registered for this job in this process.");
      const result = await handler.run(row);
      if (!result.success) failure = result.message || "The job reported a failure.";
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    } finally {
      clearInterval(heartbeat);
    }
    const nowMs = this.now();
    try {
      if (!failure) {
        await completeJob(db, row.id, this.workerId, nowMs);
        return;
      }
      const retryAt = row.attempts < row.maxAttempts ? nowMs + retryDelayMs(row.attempts) : null;
      await failJob(db, row.id, this.workerId, failure, nowMs, retryAt);
      this.logger.error(`[jobs] "${row.jobName}" attempt ${row.attempts} failed`, {
        id: row.id,
        error: failure,
        ...(retryAt === null ? { final: true } : { retryAt: new Date(retryAt).toISOString() }),
      });
    } catch (err) {
      // The lease runs out and the row is recovered as interrupted.
      this.logger.error(`[jobs] Could not record the result of "${row.jobName}"`, { id: row.id, error: String(err) });
    }
  }
}
