// SPDX-License-Identifier: MIT

import { getDb } from "./db.js";
import { deleteSiteSetting, getSiteSetting, settingsKeyColumn } from "./site-settings.js";
import {
  getThemeDesignDoc,
  seedThemeDesignRow,
  type ThemeDesignKind,
} from "./theme-designs-db.js";

/**
 * One-time move of per-theme customization documents out of `site_settings` and
 * into the dedicated `theme_designs` table. Runs at boot; idempotent — once a
 * (theme, kind) has a row (or was never customised) there is nothing left to do.
 *
 * `run-migrations.ts` only executes SQL files, and reshaping JSON rows portably
 * across postgres/mysql/mariadb in raw SQL is not worth the fragility, so this
 * is an application-level backfill — the same approach as the template-part and
 * header-library conversions.
 *
 * Legacy keys, one per (theme, kind), plus a `_draft` sibling:
 *   theme_mods.<themeId>   / theme_mods_draft.<themeId>
 *   theme_home.<themeId>   / theme_home_draft.<themeId>
 *   theme_blog.<themeId>   / theme_blog_draft.<themeId>
 */

const LEGACY_KEY_RE = /^theme_(mods|home|blog)(_draft)?\.(.+)$/;

interface LegacyEntry {
  kind: ThemeDesignKind;
  themeId: string;
  publishedKey: string;
  draftKey: string;
}

/** Discover which (kind, themeId) pairs still have legacy rows for this site. */
async function findLegacyEntries(siteId: string): Promise<LegacyEntry[]> {
  const db = await getDb();
  const rows = await db.query<{ key: string }>(
    `SELECT ${settingsKeyColumn()} AS key FROM site_settings WHERE site_id = ?`,
    [siteId],
  );

  const seen = new Map<string, LegacyEntry>();
  for (const { key } of rows) {
    const match = LEGACY_KEY_RE.exec(String(key));
    if (!match) continue;
    const kind = match[1] as ThemeDesignKind;
    const themeId = match[3];
    if (!themeId) continue;
    const id = `${kind}:${themeId}`;
    if (!seen.has(id)) {
      seen.set(id, {
        kind,
        themeId,
        publishedKey: `theme_${kind}.${themeId}`,
        draftKey: `theme_${kind}_draft.${themeId}`,
      });
    }
  }
  return [...seen.values()];
}

export async function migrateThemeDesignsFromSettings(siteId: string): Promise<void> {
  let entries: LegacyEntry[];
  try {
    entries = await findLegacyEntries(siteId);
  } catch (err) {
    console.error("[justflows] theme-design migration: could not scan settings:", err);
    return;
  }

  for (const { kind, themeId, publishedKey, draftKey } of entries) {
    try {
      const inTable = await getThemeDesignDoc<unknown>(siteId, themeId, kind);
      const published = await getSiteSetting<unknown>(siteId, publishedKey);
      const draft = await getSiteSetting<unknown>(siteId, draftKey);

      // Seed when the table has nothing yet and either doc exists — a draft-only
      // customization (started, never published) must survive the move too.
      if (inTable == null && (published != null || draft != null)) {
        await seedThemeDesignRow(siteId, themeId, kind, published ?? {}, draft ?? null);
      }

      // Drop the old rows once the table has (or never needed) the data.
      if (published != null) await deleteSiteSetting(siteId, publishedKey);
      if (draft != null) await deleteSiteSetting(siteId, draftKey);
    } catch (err) {
      console.error(
        `[justflows] theme-design migration failed for "${kind}" / "${themeId}":`,
        err,
      );
    }
  }
}
