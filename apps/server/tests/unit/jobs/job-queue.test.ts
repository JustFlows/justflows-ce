// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from "vitest";
import type { JobQueueRow } from "../../../src/lib/jobs/job-queue-db.js";

/** `job_queue` in memory, with the same conditional updates as the SQL. */
const store = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), available: true }));

vi.mock("../../../src/lib/jobs/job-queue-db.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../src/lib/jobs/job-queue-db.js")>();
  const rows = () => [...store.rows.values()];
  const row = (r: Record<string, unknown>): JobQueueRow => ({
    id: String(r.id), jobName: String(r.jobName), siteId: (r.siteId as string | null) ?? null,
    payload: r.payload == null ? undefined : JSON.parse(String(r.payload)),
    status: r.status as JobQueueRow["status"], attempts: Number(r.attempts), maxAttempts: Number(r.maxAttempts),
    runAt: new Date(Number(r.runAt)), lockedBy: (r.lockedBy as string | null) ?? null,
    lockedUntil: r.lockedUntil == null ? null : new Date(Number(r.lockedUntil)),
    lastError: (r.lastError as string | null) ?? null, createdAt: null,
    finishedAt: r.finishedAt == null ? null : new Date(Number(r.finishedAt)),
  });
  return {
    ...real,
    jobQueueAvailable: async () => store.available,
    insertJob: async (_db: unknown, job: { id: string; jobName: string; siteId: string | null; payload: string | null; maxAttempts: number; runAtMs: number }) => {
      store.rows.set(job.id, { ...job, runAt: job.runAtMs, status: "queued", attempts: 0, lockedBy: null, lockedUntil: null, lastError: null, finishedAt: null });
    },
    dueJobs: async (_db: unknown, names: string[], nowMs: number, limit: number) =>
      rows().filter((r) => r.status === "queued" && Number(r.runAt) <= nowMs && names.includes(String(r.jobName)))
        .sort((a, b) => Number(a.runAt) - Number(b.runAt)).slice(0, limit).map(row),
    claimJob: async (_db: unknown, id: string, worker: string, nowMs: number, leaseMs: number) => {
      const r = store.rows.get(id);
      if (!r || r.status !== "queued" || Number(r.runAt) > nowMs) return false;
      Object.assign(r, { status: "running", lockedBy: worker, lockedUntil: nowMs + leaseMs, attempts: Number(r.attempts) + 1 });
      return true;
    },
    extendLease: async (_db: unknown, id: string, worker: string, nowMs: number, leaseMs: number) => {
      const r = store.rows.get(id);
      if (!r || r.status !== "running" || r.lockedBy !== worker) return false;
      r.lockedUntil = nowMs + leaseMs;
      return true;
    },
    completeJob: async (_db: unknown, id: string, worker: string, nowMs: number) => {
      const r = store.rows.get(id);
      if (!r || r.status !== "running" || r.lockedBy !== worker) return false;
      Object.assign(r, { status: "done", lockedBy: null, lockedUntil: null, lastError: null, finishedAt: nowMs });
      return true;
    },
    failJob: async (_db: unknown, id: string, worker: string, error: string, nowMs: number, retryAtMs: number | null) => {
      const r = store.rows.get(id);
      if (!r || r.status !== "running" || r.lockedBy !== worker) return false;
      Object.assign(r, retryAtMs === null
        ? { status: "failed", lockedBy: null, lockedUntil: null, lastError: error, finishedAt: nowMs }
        : { status: "queued", lockedBy: null, lockedUntil: null, lastError: error, runAt: retryAtMs });
      return true;
    },
    recoverExpiredJobs: async (_db: unknown, nowMs: number) => {
      let requeued = 0;
      let failed = 0;
      for (const r of rows()) {
        if (r.status !== "running" || Number(r.lockedUntil) >= nowMs) continue;
        if (Number(r.attempts) >= Number(r.maxAttempts)) {
          Object.assign(r, { status: "failed", lockedBy: null, lockedUntil: null, lastError: real.INTERRUPTED_ERROR, finishedAt: nowMs });
          failed += 1;
        } else {
          Object.assign(r, { status: "queued", lockedBy: null, lockedUntil: null, lastError: real.INTERRUPTED_ERROR, runAt: nowMs });
          requeued += 1;
        }
      }
      return { requeued, failed };
    },
    pruneJobs: async () => 0,
  };
});

const { DurableJobQueue, retryDelayMs } = await import("../../../src/lib/jobs/job-queue.js");

function queue(clock: { now: number }, workerId = "worker-a") {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const q = new DurableJobQueue({ db: async () => ({}) as never, workerId, now: () => clock.now, leaseMs: 60_000, logger });
  return { q, logger };
}

function reset() {
  store.rows.clear();
  store.available = true;
}

describe("durable job queue", () => {
  it("stores each run with its own payload and runs it once", async () => {
    reset();
    const clock = { now: Date.parse("2026-10-11T10:00:00Z") };
    const { q } = queue(clock);
    const seen: unknown[] = [];
    q.register("shop:task", { maxAttempts: 3, run: async (row) => { seen.push(row.payload); return { success: true }; } });
    await q.enqueue("shop:task", { payload: { site: "a" }, siteId: "a" });
    await q.enqueue("shop:task", { payload: { site: "b" }, siteId: "b" });
    expect(store.rows.size).toBe(2);

    expect(await q.tick()).toBe(2);
    await q.idle();
    expect(seen).toEqual([{ site: "a" }, { site: "b" }]);
    expect([...store.rows.values()].map((r) => r.status)).toEqual(["done", "done"]);
    expect(await q.tick()).toBe(0);
  });

  it("waits for the delay and only takes jobs registered in this process", async () => {
    reset();
    const clock = { now: 1_000_000 };
    const { q } = queue(clock);
    q.register("a:later", { maxAttempts: 1, run: async () => ({ success: true }) });
    await q.enqueue("a:later", { delayMs: 30_000 });
    store.rows.set("other", { id: "other", jobName: "b:unknown", siteId: null, payload: null, status: "queued", attempts: 0, maxAttempts: 1, runAt: 0 });
    expect(await q.tick()).toBe(0);
    clock.now += 30_000;
    expect(await q.tick()).toBe(1);
    await q.idle();
    expect(store.rows.get("other")?.status).toBe("queued");
    await expect(q.enqueue("nope")).rejects.toThrow(/not registered/);
  });

  it("retries a failure with backoff and keeps it as failed after the last attempt", async () => {
    reset();
    const clock = { now: 0 };
    const { q, logger } = queue(clock);
    let calls = 0;
    q.register("shop:flaky", {
      maxAttempts: 3,
      run: async () => {
        calls += 1;
        if (calls === 1) throw new Error("network down");
        return { success: false, message: "2 events not sent" };
      },
    });
    const id = await q.enqueue("shop:flaky");
    await q.tick(); await q.idle();
    expect(store.rows.get(id)).toMatchObject({ status: "queued", attempts: 1, lastError: "network down", runAt: retryDelayMs(1) });

    clock.now = retryDelayMs(1);
    await q.tick(); await q.idle();
    expect(store.rows.get(id)).toMatchObject({ status: "queued", attempts: 2, lastError: "2 events not sent" });
    expect(Number(store.rows.get(id)?.runAt)).toBe(clock.now + retryDelayMs(2));

    clock.now += retryDelayMs(2);
    await q.tick(); await q.idle();
    expect(store.rows.get(id)).toMatchObject({ status: "failed", attempts: 3 });
    expect(calls).toBe(3);
    expect(logger.error).toHaveBeenCalledTimes(3);
    expect([1, 2, 3, 4, 5].map((n) => retryDelayMs(n) / 60_000)).toEqual([1, 5, 25, 60, 60]);
  });

  it("gives a run back when its process died, and counts it as an attempt", async () => {
    reset();
    const clock = { now: 0 };
    const dead = queue(clock, "worker-dead").q;
    dead.register("shop:backup", { maxAttempts: 2, run: () => new Promise(() => undefined) });
    const id = await dead.enqueue("shop:backup", { payload: { taskId: "t1" } });
    await dead.tick();
    expect(store.rows.get(id)).toMatchObject({ status: "running", lockedBy: "worker-dead", attempts: 1 });

    const { q: alive } = queue(clock, "worker-b");
    const ran: unknown[] = [];
    alive.register("shop:backup", { maxAttempts: 2, run: async (row) => { ran.push(row.payload); return { success: true }; } });
    expect(await alive.tick()).toBe(0);
    clock.now = 60_001;
    expect(await alive.tick()).toBe(1);
    await alive.idle();
    expect(ran).toEqual([{ taskId: "t1" }]);
    expect(store.rows.get(id)).toMatchObject({ status: "done", attempts: 2 });
  });

  it("fails an interrupted run that has no attempts left", async () => {
    reset();
    const clock = { now: 0 };
    const dead = queue(clock, "worker-dead").q;
    dead.register("shop:once", { maxAttempts: 1, run: () => new Promise(() => undefined) });
    const id = await dead.enqueue("shop:once");
    await dead.tick();
    clock.now = 120_000;
    const { q: alive } = queue(clock, "worker-b");
    alive.register("shop:once", { maxAttempts: 1, run: async () => ({ success: true }) });
    await alive.tick();
    expect(store.rows.get(id)).toMatchObject({ status: "failed", lastError: expect.stringMatching(/Interrupted/) });
  });

  it("lets only one of two workers run a row", async () => {
    reset();
    const clock = { now: 0 };
    const runs: string[] = [];
    const a = queue(clock, "worker-a").q;
    const b = queue(clock, "worker-b").q;
    for (const [w, q] of [["a", a], ["b", b]] as const) {
      q.register("shop:one", { maxAttempts: 1, run: async () => { runs.push(w); return { success: true }; } });
    }
    await a.enqueue("shop:one");
    await Promise.all([a.tick(), b.tick()]);
    await Promise.all([a.idle(), b.idle()]);
    expect(runs).toHaveLength(1);
  });

  it("keeps a long run's lease with a heartbeat", async () => {
    reset();
    vi.useFakeTimers();
    try {
      const clock = { now: 0 };
      const { q } = queue(clock);
      let finish: () => void = () => undefined;
      q.register("shop:long", { maxAttempts: 1, run: () => new Promise((resolve) => { finish = () => resolve({ success: true }); }) });
      const id = await q.enqueue("shop:long");
      await q.tick();
      for (let i = 0; i < 6; i += 1) {
        clock.now += 20_000;
        await vi.advanceTimersByTimeAsync(20_000);
      }
      expect(Number(store.rows.get(id)?.lockedUntil)).toBeGreaterThan(clock.now);
      finish();
      await q.idle();
      expect(store.rows.get(id)?.status).toBe("done");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing without the table", async () => {
    reset();
    store.available = false;
    const { q } = queue({ now: 0 });
    q.register("shop:x", { maxAttempts: 1, run: async () => ({ success: true }) });
    expect(await q.isAvailable()).toBe(false);
    expect(await q.tick()).toBe(0);
  });
});
