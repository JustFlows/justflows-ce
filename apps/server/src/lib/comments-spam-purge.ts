// SPDX-License-Identifier: MIT

import { JobScheduler } from "@justflows/jobs";
import { getDb } from "./db.js";
import { getCommentSettings } from "./comments-settings.js";
import { auditLog } from "./audit-log.js";

/** Hard-delete comments marked spam past each site's configured retention window. */
export async function purgeExpiredSpam(): Promise<number> {
  const db = await getDb();
  const sites = await db.query<{ id: string }>("SELECT id FROM sites");
  let purged = 0;
  for (const site of sites) {
    const settings = await getCommentSettings(site.id);
    const cutoff = new Date(Date.now() - settings.spamRetentionDays * 86_400_000)
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d+Z$/, "");
    const stale = await db.query<{ id: string }>(
      "SELECT id FROM comments WHERE site_id = ? AND status = 'spam' AND updated_at < ?",
      [site.id, cutoff],
    );
    if (!stale.length) continue;
    await db.run("DELETE FROM comments WHERE site_id = ? AND status = 'spam' AND updated_at < ?", [
      site.id,
      cutoff,
    ]);
    for (const row of stale) {
      await auditLog({
        siteId: site.id,
        action: "trash.purged",
        target: row.id,
        detail: "type=comment;spam_retention=true",
      });
    }
    purged += stale.length;
  }
  return purged;
}

let scheduler: JobScheduler | null = null;
export function startCommentSpamPurgeJob(): void {
  if (scheduler) return;
  scheduler = new JobScheduler(console);
  scheduler.register({
    name: "comments.purge-expired-spam",
    schedule: "41 3 * * *",
    maxAttempts: 3,
    handler: async () => ({
      success: true,
      message: `Purged ${await purgeExpiredSpam()} expired spam comments`,
    }),
  });
  scheduler.start();
}
