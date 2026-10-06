// SPDX-License-Identifier: MIT

import { getControlDb } from "../database/db.js";
import { readSaasSettings } from "./saas-settings.js";
import { deletedLongEnough, purgeDeletedTenant } from "./purge-deleted.js";

const DAY_MS = 24 * 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function purgeExpiredDeletedTenants(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const db = await getControlDb();
    const settings = await db.query<{ value: unknown }>("SELECT value FROM platform_settings WHERE setting_key = 'saas' LIMIT 1");
    const days = readSaasSettings(settings[0]?.value)?.purgeAfterDays ?? 30;
    if (days < 1) return;
    const tenants = await db.query<{ id: string; updated_at: string | Date }>(
      "SELECT id, updated_at FROM tenants WHERE status = 'deleted' AND slug <> 'primary'",
    );
    for (const tenant of tenants) {
      if (!deletedLongEnough(tenant.updated_at, days)) continue;
      const result = await purgeDeletedTenant(tenant.id, null);
      if (!result.ok) console.error("[justflows] Could not remove deleted workspace", tenant.id, result.error);
    }
  } catch (err) {
    console.error("[justflows] Deleted-website cleanup failed:", err);
  } finally {
    running = false;
  }
}

/** Removes websites that have stayed deleted longer than the platform setting. */
export function startDeletedSitePurgeJob(): void {
  if (timer) return;
  void purgeExpiredDeletedTenants();
  timer = setInterval(() => {
    void purgeExpiredDeletedTenants();
  }, DAY_MS);
}
