// SPDX-License-Identifier: MIT

import { JobScheduler, type JobDefinition, type JobResult } from "@justflows/jobs";

/**
 * The one scheduler for the host's own background work (trash purge, scheduled
 * publishing, webhook delivery, update checks, ...). Plugin jobs live on
 * `getPluginJobScheduler()`; diagnostics lists both.
 *
 * Every core job repeats on its schedule. A handler that throws is recorded as
 * a failed result and runs again at its next slot instead of being retried a
 * few times and then stopping for good, which would silently end a purge or
 * update check until someone pressed Retry.
 */

let scheduler: JobScheduler | null = null;
const registered = new Set<string>();

export function getCoreJobScheduler(): JobScheduler {
  if (!scheduler) {
    scheduler = new JobScheduler(console);
    scheduler.start();
  }
  return scheduler;
}

export interface CoreJobOptions {
  /** Also run once this many milliseconds after registering (boot). */
  runAfterMs?: number;
}

/** Register a recurring core job. Registering the same name again is a no-op. */
export function registerCoreJob(
  def: Omit<JobDefinition, "maxAttempts"> & { schedule: string },
  options: CoreJobOptions = {},
): void {
  if (registered.has(def.name)) return;
  registered.add(def.name);
  const jobs = getCoreJobScheduler();
  jobs.register({
    ...def,
    maxAttempts: 1,
    handler: async (ctx): Promise<JobResult> => {
      try {
        return await def.handler(ctx);
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
  });
  if (options.runAfterMs !== undefined) jobs.enqueue(def.name, options.runAfterMs);
}

export function unregisterCoreJob(name: string): void {
  if (!registered.delete(name)) return;
  scheduler?.unregister(name);
}
