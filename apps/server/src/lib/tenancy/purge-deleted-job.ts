// SPDX-License-Identifier: MIT

import { getControlDb } from "../database/db.js";
import { readSaasSettings } from "./saas-settings.js";
import { deletedLongEnough, purgeDeletedTenant } from "./purge-deleted.js";
import { registerCoreJob } from "../jobs/core-jobs.js";
import type { JobResult } from "@justflows/jobs";

let running = false;

export async function purgeExpiredDeletedTenants(): Promise<JobResult> {
  if (running) return { success: true, message: "Already running" };
  running = true;
  let removed = 0;
  let failed = 0;
  try {
    const db = await getControlDb();
    const settings = await db.query<{ value: unknown }>("SELECT value FROM platform_settings WHERE setting_key = 'saas' LIMIT 1");
    const days = readSaasSettings(settings[0]?.value)?.purgeAfterDays ?? 30;
    if (days < 1) return { success: true, message: "Purging deleted websites is off" };
    let after: string | undefined;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
    for (;;) {
      const tenants = await db.query<{ id: string; deletion_requested_at: string | Date }>(
        `SELECT id, deletion_requested_at FROM tenants WHERE status IN ('deleted', 'suspended') AND deletion_requested_at <= ? AND slug <> 'primary'${after ? " AND id > ?" : ""} ORDER BY id LIMIT 100`,
        [cutoff, ...(after ? [after] : [])],
      );
      if (tenants.length === 0) break;
      after = tenants[tenants.length - 1]!.id;
      for (const tenant of tenants) {
        if (!deletedLongEnough(tenant.deletion_requested_at, days)) continue;
        try {
          const result = await purgeDeletedTenant(tenant.id, null);
          if (result.ok) removed++;
          else failed++;
        } catch {
          failed++;
          console.error("[justflows] Could not remove workspace", tenant.id);
        }
      }
      if (tenants.length < 100) break;
    }
    return { success: failed === 0, message: `Removed ${removed} deleted websites${failed ? `, ${failed} failed` : ""}` };
  } catch (err) {
    console.error("[justflows] Deleted-website cleanup failed:", err);
    return { success: false, message: "Deleted-website cleanup failed" };
  } finally {
    running = false;
  }
}

/** Removes suspended/deleted workspaces after the platform retention period. Runs after boot and once a day. */
export function startDeletedSitePurgeJob(): void {
  registerCoreJob(
    { name: "tenancy.purge-deleted-sites", schedule: "53 3 * * *", handler: purgeExpiredDeletedTenants },
    { runAfterMs: 0 },
  );
}
