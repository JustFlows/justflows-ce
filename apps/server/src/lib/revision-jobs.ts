// SPDX-License-Identifier: MIT

import { pruneHistoricalBatch } from "./content-revisions.js";
import { auditLog } from "./audit-log.js";
import { getSiteId } from "./site-settings.js";

const DAY_MS = 24 * 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function runPrune(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const removed = await pruneHistoricalBatch();
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
  } catch (err) {
    console.error("[justflows] Revision prune failed:", err);
  } finally {
    running = false;
  }
}

/** Bounded historical-revision cleanup. Runs after boot and once a day. */
export function startRevisionJobs(): void {
  if (timer) return;
  void runPrune();
  timer = setInterval(() => {
    void runPrune();
  }, DAY_MS);
}

export function stopRevisionJobs(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
