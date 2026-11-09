// SPDX-License-Identifier: MIT

import { getDb, type DbClient } from "../database/db.js";
import { toIsoTimestamp } from "./content-api.js";

export interface TranslationGroupDates {
  createdAt: string | null;
  publishedAt: string | null;
}

/**
 * Earliest creation and publish dates of the other entries in a translation
 * group. A translation is the same entry in another language, so it shares
 * these dates instead of starting its own. Returns ISO timestamps, or null
 * when no other entry has the date.
 */
export async function translationGroupDates(
  siteId: string,
  groupId: string,
  excludeId: string,
  db?: Pick<DbClient, "query">,
): Promise<TranslationGroupDates> {
  const client = db ?? (await getDb());
  const [row] = await client.query<{ created_at: unknown; published_at: unknown }>(
    `SELECT MIN(created_at) AS created_at, MIN(published_at) AS published_at
     FROM content WHERE site_id = ? AND COALESCE(translation_group_id, id) = ? AND id <> ?`,
    [siteId, groupId, excludeId],
  );
  return {
    createdAt: toIsoTimestamp(row?.created_at),
    publishedAt: toIsoTimestamp(row?.published_at),
  };
}

/** An ISO timestamp in the `YYYY-MM-DD HH:MM:SS` UTC form that `now()` writes. */
export function contentTimestamp(iso: string): string {
  return new Date(iso).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}
