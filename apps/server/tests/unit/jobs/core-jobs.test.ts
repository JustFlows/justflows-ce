import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("core job scheduler", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists registered core jobs once, however often they are registered", async () => {
    const { getCoreJobScheduler, registerCoreJob } = await import("../../../src/lib/jobs/core-jobs.js");
    const handler = vi.fn(async () => ({ success: true }));
    registerCoreJob({ name: "test.daily", schedule: "17 3 * * *", handler });
    registerCoreJob({ name: "test.daily", schedule: "17 3 * * *", handler });
    const jobs = getCoreJobScheduler().listJobs();
    expect(jobs.map((job) => job.name)).toEqual(["test.daily"]);
    expect(jobs[0]).toMatchObject({ schedule: "17 3 * * *", maxAttempts: 1, status: "pending" });
    getCoreJobScheduler().stop();
  });

  it("records a throwing run as a failed result and keeps the job on its schedule", async () => {
    const { getCoreJobScheduler, registerCoreJob } = await import("../../../src/lib/jobs/core-jobs.js");
    registerCoreJob(
      { name: "test.boom", schedule: "* * * * *", handler: async () => { throw new Error("disk full"); } },
      { runAfterMs: 0 },
    );
    await vi.advanceTimersByTimeAsync(30_000);
    const [job] = getCoreJobScheduler().listJobs();
    expect(job).toMatchObject({ status: "pending", lastResult: { success: false, message: "disk full" } });
    getCoreJobScheduler().stop();
  });

  it("drops a job on unregister so it can be registered again", async () => {
    const { getCoreJobScheduler, registerCoreJob, unregisterCoreJob } = await import("../../../src/lib/jobs/core-jobs.js");
    const def = { name: "test.again", schedule: "* * * * *", handler: async () => ({ success: true }) };
    registerCoreJob(def);
    unregisterCoreJob("test.again");
    expect(getCoreJobScheduler().listJobs()).toEqual([]);
    registerCoreJob(def);
    expect(getCoreJobScheduler().listJobs()).toHaveLength(1);
    getCoreJobScheduler().stop();
  });
});
