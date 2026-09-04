// SPDX-License-Identifier: MIT

/**
 * Detached entrypoint for a core update.
 *
 * `startCoreUpdate` spawns this file with `{ detached: true }` so the work — file
 * copy, migrations, `pnpm install`, rebuild, Passenger restart — runs outside the
 * HTTP request and survives the web worker being recycled. Progress and the
 * final result are written to `.updates/status.json`; the admin UI polls it.
 */

import { clearLock, patchUpdateStatus, readUpdateJob } from "./core-update-status.js";
import { executeUpdateJob } from "./core-updater.js";

async function main(): Promise<number> {
  const job = readUpdateJob();
  if (!job) {
    patchUpdateStatus({
      running: false,
      phase: "failed",
      ok: false,
      error: "No update job was found on disk",
      finishedAt: Date.now(),
    });
    clearLock();
    return 1;
  }

  const result = await executeUpdateJob(job);
  return result.ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    try {
      patchUpdateStatus({
        running: false,
        phase: "failed",
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        finishedAt: Date.now(),
      });
      clearLock();
    } catch {
      /* nothing more we can do */
    }
    process.exit(1);
  });
