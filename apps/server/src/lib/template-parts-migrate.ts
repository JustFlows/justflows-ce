// SPDX-License-Identifier: MIT

import { deleteSiteSetting, getSiteSetting } from "./site-settings.js";
import { getTemplatePartDoc, seedTemplatePartRow } from "./template-parts-db.js";

/**
 * One-time move of template-part documents out of `site_settings` and into the
 * dedicated `template_parts` table. Runs at boot; idempotent — once a part has a
 * row (or was never customised) there is nothing left to do.
 *
 * `run-migrations.ts` only executes SQL files, and reshaping JSON rows portably
 * across postgres/mysql/mariadb in raw SQL is not worth the fragility, so this
 * is an application-level backfill like the header library conversion.
 */

// Parts that previously lived under these `site_settings` keys.
const PARTS: { part: string; publishedKey: string; draftKey: string }[] = [
  { part: "footer", publishedKey: "template_part.footer", draftKey: "template_part_draft.footer" },
  { part: "header", publishedKey: "template_part.header", draftKey: "template_part_draft.header" },
];

export async function migrateTemplatePartsFromSettings(siteId: string): Promise<void> {
  for (const { part, publishedKey, draftKey } of PARTS) {
    try {
      // Already in the table? Nothing to move.
      const inTable = await getTemplatePartDoc<unknown>(siteId, part);
      const published = await getSiteSetting<unknown>(siteId, publishedKey);
      const draft = await getSiteSetting<unknown>(siteId, draftKey);

      if (inTable == null && published != null) {
        await seedTemplatePartRow(siteId, part, published, draft ?? null);
      }

      // Drop the old rows once the table has (or never needed) the data.
      if (published != null) await deleteSiteSetting(siteId, publishedKey);
      if (draft != null) await deleteSiteSetting(siteId, draftKey);
    } catch (err) {
      console.error(`[justflows] template-part migration failed for "${part}":`, err);
    }
  }
}
