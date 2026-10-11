// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../../src/lib/database/db.js";
import {
  claimJob,
  completeJob,
  countJobs,
  dueJobs,
  extendLease,
  failJob,
  insertJob,
  jobQueueAvailable,
  listOpenJobs,
  pruneJobs,
  recoverExpiredJobs,
  retryFailedJob,
  DONE_RETENTION_MS,
} from "../../../src/lib/jobs/job-queue-db.js";
import { DurableJobQueue } from "../../../src/lib/jobs/job-queue.js";

/**
 * Run with a disposable database (try a non-UTC `TZ` too):
 *   JOB_QUEUE_TEST_DATABASE=1 DB_NAME=job_queue_test DB_DRIVER=postgres|mysql|mariadb \
 *   DB_HOST=… DB_PORT=… DB_USER=… DB_PASSWORD=… TZ=Europe/Amsterdam \
 *   pnpm vitest run tests/integration/database/job-queue-db.integration.test.ts
 */
const enabled = process.env.JOB_QUEUE_TEST_DATABASE === "1" && process.env.DB_NAME === "job_queue_test";

const MIGRATION = fileURLToPath(new URL(
  `../../../../../migrations/0048_job_queue${process.env.DB_DRIVER === "postgres" ? "" : ".mysql"}.sql`,
  import.meta.url,
));

describe.skipIf(!enabled)("job queue on a real database", () => {
  const t0 = Date.parse("2026-10-11T10:00:00.000Z");

  beforeAll(async () => {
    const db = await getDb();
    await db.run("DROP TABLE IF EXISTS job_queue");
    const ddl = readFileSync(MIGRATION, "utf8").split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
    for (const statement of ddl.split(";").map((part) => part.trim()).filter(Boolean)) await db.run(statement);
  });

  afterAll(async () => {
    const db = await getDb();
    await db.run("DROP TABLE IF EXISTS job_queue");
    await db.close();
  });

  beforeEach(async () => {
    await (await getDb()).run("DELETE FROM job_queue");
  });

  const add = async (name: string, runAtMs: number, extra: { siteId?: string; payload?: string; maxAttempts?: number } = {}) => {
    const id = randomUUID();
    await insertJob(await getDb(), {
      id, jobName: name, siteId: extra.siteId ?? null, payload: extra.payload ?? null,
      maxAttempts: extra.maxAttempts ?? 3, runAtMs, nowMs: t0,
    });
    return id;
  };

  it("finds the table and returns due rows with their payload and times intact", async () => {
    const db = await getDb();
    expect(await jobQueueAvailable(db)).toBe(true);
    const site = randomUUID();
    const due = await add("shop:task", t0, { siteId: site, payload: JSON.stringify({ taskId: "t1", note: "ü" }) });
    await add("shop:task", t0 + 60_000);
    await add("other:job", t0);
    const rows = await dueJobs(db, ["shop:task"], t0, 10);
    expect(rows.map((row) => row.id)).toEqual([due]);
    expect(rows[0]).toMatchObject({ siteId: site, payload: { taskId: "t1", note: "ü" }, status: "queued", attempts: 0, maxAttempts: 3 });
    expect(rows[0]!.runAt.toISOString()).toBe(new Date(t0).toISOString());
    expect((await dueJobs(db, ["shop:task"], t0 + 60_000, 10)).length).toBe(2);
  });

  it("lets exactly one of many concurrent claims win", async () => {
    const db = await getDb();
    const id = await add("shop:task", t0);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => claimJob(db, id, `worker-${i}`, t0, 60_000)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const [row] = await db.query<Record<string, unknown>>("SELECT status, attempts FROM job_queue WHERE id = ?", [id]);
    expect(row).toMatchObject({ status: "running" });
    expect(Number(row?.attempts)).toBe(1);
  });

  it("only lets the lease holder extend, finish, or fail a run", async () => {
    const db = await getDb();
    const id = await add("shop:task", t0);
    expect(await claimJob(db, id, "a", t0, 60_000)).toBe(true);
    expect(await extendLease(db, id, "b", t0 + 1_000, 60_000)).toBe(false);
    expect(await completeJob(db, id, "b", t0 + 1_000)).toBe(false);
    expect(await extendLease(db, id, "a", t0 + 1_000, 60_000)).toBe(true);
    expect(await failJob(db, id, "a", "boom", t0 + 2_000, t0 + 62_000)).toBe(true);
    const [retry] = await dueJobs(db, ["shop:task"], t0 + 62_000, 1);
    expect(retry).toMatchObject({ id, status: "queued", attempts: 1, lastError: "boom" });
    expect(await dueJobs(db, ["shop:task"], t0 + 61_999, 1)).toEqual([]);
    expect(await claimJob(db, id, "a", t0 + 62_000, 60_000)).toBe(true);
    expect(await completeJob(db, id, "a", t0 + 63_000)).toBe(true);
    expect((await countJobs(db)).done).toBe(1);
  });

  it("recovers runs whose lease ran out, failing those without attempts left", async () => {
    const db = await getDb();
    const again = await add("shop:task", t0, { maxAttempts: 2 });
    const last = await add("shop:task", t0, { maxAttempts: 1 });
    const fresh = await add("shop:task", t0, { maxAttempts: 1 });
    await claimJob(db, again, "dead", t0, 60_000);
    await claimJob(db, last, "dead", t0, 60_000);
    await claimJob(db, fresh, "alive", t0 + 30_000, 60_000);
    expect(await recoverExpiredJobs(db, t0 + 60_001)).toEqual({ requeued: 1, failed: 1 });
    const open = await listOpenJobs(db);
    const status = Object.fromEntries(open.map((row) => [row.id, row.status]));
    expect(status).toEqual({ [again]: "queued", [last]: "failed", [fresh]: "running" });
    expect(open.find((row) => row.id === last)?.lastError).toMatch(/Interrupted/);
    expect("payload" in open[0]!).toBe(false);

    expect(await retryFailedJob(db, last, t0 + 70_000)).toBe(true);
    expect(await retryFailedJob(db, last, t0 + 70_000)).toBe(false);
    const [retried] = await dueJobs(db, ["shop:task"], t0 + 70_000, 5).then((rows) => rows.filter((row) => row.id === last));
    expect(retried).toMatchObject({ attempts: 0 });
  });

  it("prunes old finished rows and keeps recent and open ones", async () => {
    const db = await getDb();
    const old = await add("shop:task", t0);
    const recent = await add("shop:task", t0);
    const open = await add("shop:task", t0);
    for (const [id, at] of [[old, t0], [recent, t0 + DONE_RETENTION_MS]] as const) {
      await claimJob(db, id, "a", t0, 60_000);
      await completeJob(db, id, "a", at);
    }
    expect(await pruneJobs(db, t0 + DONE_RETENTION_MS + 1_000)).toBe(1);
    const left = (await db.query<{ id: string }>("SELECT id FROM job_queue")).map((row) => String(row.id)).sort();
    expect(left).toEqual([recent, open].sort());
  });

  it("runs stored jobs end to end through two workers", async () => {
    const ran: string[] = [];
    const make = (worker: string) => {
      const queue = new DurableJobQueue({ db: () => getDb(), workerId: worker, logger: { info() {}, warn() {}, error() {} } });
      queue.register("shop:e2e", {
        maxAttempts: 2,
        run: async (row) => {
          ran.push(`${worker}:${(row.payload as { n: number }).n}`);
          return { success: true };
        },
      });
      return queue;
    };
    const a = make("a");
    const b = make("b");
    for (let n = 0; n < 6; n += 1) await a.enqueue("shop:e2e", { payload: { n } });
    await Promise.all([a.tick(), b.tick()]);
    await Promise.all([a.idle(), b.idle()]);
    await Promise.all([a.tick(), b.tick()]);
    await Promise.all([a.idle(), b.idle()]);
    expect(ran.map((entry) => Number(entry.split(":")[1])).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect((await countJobs(await getDb())).done).toBe(6);
  });
});
