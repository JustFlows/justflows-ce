// SPDX-License-Identifier: MIT

import { eachActiveSite } from "../tenancy/connections.js";
import { installationRootSiteId } from "../tenancy/registry.js";
import { copyPrivateFiles, forgetUnusedConnections, storageIdsInUse } from "./private-storage.js";
import { registerCoreJob } from "../jobs/core-jobs.js";
import type { JobResult } from "@justflows/jobs";

/**
 * Copies private files to each site's current storage after the storage
 * changed. Runs every five minutes and right after a storage setting is saved;
 * each run copies up to 200 files per site, so a large library moves over
 * several runs. When no site has files left on the root site's earlier
 * connections, those are forgotten.
 */

const PER_SITE = 200;

let running = false;
let again = false;

export async function runPrivateFilesCopy(): Promise<JobResult> {
  if (running) {
    again = true;
    return { success: true, message: "Already running" };
  }
  running = true;
  let copied = 0;
  let failed = 0;
  try {
    const inUse = new Set<string>();
    await eachActiveSite(async (siteId) => {
      try {
        const result = await copyPrivateFiles(siteId, PER_SITE);
        copied += result.copied;
        failed += result.failed;
        if (result.copied || result.failed) {
          console.info(`[private-files] site ${siteId}: copied ${result.copied}, failed ${result.failed}, left ${result.left}`);
        }
        for (const id of await storageIdsInUse(siteId)) inUse.add(id);
      } catch (err) {
        // A site we could not read may still use an earlier connection: keep them all.
        inUse.add("*");
        failed++;
        console.error("[private-files] copy run failed for site", siteId, err instanceof Error ? err.message : "unknown error");
      }
    });
    const rootId = await installationRootSiteId().catch(() => null);
    if (rootId && !inUse.has("*")) {
      await eachActiveSite(async (siteId) => {
        if (siteId === rootId) await forgetUnusedConnections(rootId, inUse);
      });
    }
    return { success: failed === 0, message: `Copied ${copied} private files${failed ? `, ${failed} failed` : ""}` };
  } finally {
    running = false;
    if (again) {
      again = false;
      void runPrivateFilesCopy();
    }
  }
}

export function startPrivateFilesCopyJob(): void {
  registerCoreJob({ name: "files.private-copy", schedule: "*/5 * * * *", handler: runPrivateFilesCopy });
}
