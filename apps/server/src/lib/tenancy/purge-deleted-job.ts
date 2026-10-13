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
    const tenants = await db.query<{ id: string; updated_at: string | Date }>(
      "SELECT id, updated_at FROM tenants WHERE status = 'deleted' AND slug <> 'primary'",
    );
    for (const tenant of tenants) {
      if (!deletedLongEnough(tenant.updated_at, days)) continue;
      const result = await purgeDeletedTenant(tenant.id, null);
      if (result.ok) removed++;
      else {
        failed++;
        console.error("[justflows] Could not remove deleted workspace", tenant.id, result.error);
      }
    }
    return { success: failed === 0, message: `Removed ${removed} deleted websites${failed ? `, ${failed} failed` : ""}` };
  } catch (err) {
    console.error("[justflows] Deleted-website cleanup failed:", err);
    return { success: false, message: "Deleted-website cleanup failed" };
  } finally {
    running = false;
  }
}

/** Removes websites that have stayed deleted longer than the platform setting. Runs after boot and once a day. */
export function startDeletedSitePurgeJob(): void {
  registerCoreJob(
    { name: "tenancy.purge-deleted-sites", schedule: "53 3 * * *", handler: purgeExpiredDeletedTenants },
    { runAfterMs: 0 },
  );
}
