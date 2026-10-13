// SPDX-License-Identifier: MIT

import { pruneHistoricalBatch } from "./content-revisions.js";
import { auditLog } from "../security/audit-log.js";
import { getSiteId } from "../settings/site-settings.js";
import { registerCoreJob, unregisterCoreJob } from "../jobs/core-jobs.js";
import type { JobResult } from "@justflows/jobs";

const JOB_NAME = "content.revision-prune";

let running = false;

async function runPrune(): Promise<JobResult> {
  if (running) return { success: true, message: "Already running" };
  running = true;
  let total = 0;
  try {
    const { runAcrossDatabases } = await import("../tenancy/connections.js");
    await runAcrossDatabases(async () => {
      const removed = await pruneHistoricalBatch();
      total += removed;
      if (removed > 0) {
        const siteId = await getSiteId();
        if (siteId) {
          void auditLog({
            siteId,
            action: "content.revision_pruned",
            detail: `removed=${removed}`,
          });
        }
      }
    });
    return { success: true, message: `Pruned ${total} revisions` };
  } catch (err) {
    console.error("[justflows] Revision prune failed:", err);
    return { success: false, message: "Revision prune failed" };
  } finally {
    running = false;
  }
}

/** Bounded historical-revision cleanup. Runs after boot and once a day. */
export function startRevisionJobs(): void {
  registerCoreJob({ name: JOB_NAME, schedule: "29 3 * * *", handler: runPrune }, { runAfterMs: 0 });
}

export function stopRevisionJobs(): void {
  unregisterCoreJob(JOB_NAME);
}
