// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";

/**
 * Storage for per-theme customization documents in the dedicated
 * `theme_designs` table. One row per (site, theme, kind): `doc` is the published
 * document, `draft_doc` the unpublished working copy (NULL when none).
 *
 * `kind` is one of:
 *   - "mods"  — Customizer control values ({@link ThemeMods})
 *   - "home"  — homepage design ({@link BlockDocument})
 *   - "blog"  — blog index design ({@link BlockDocument})
 *
 * The document shape is the caller's concern — this layer only reads and writes
 * JSON. See `theme-customize.ts`, `theme-home-blocks.ts`, `theme-blog-blocks.ts`.
 * These are design artifacts, not site preferences, so they live here rather
 * than as `site_settings` rows (see `theme-designs-migrate.ts` for the one-time
 * move of the legacy `theme_mods.* / theme_home.* / theme_blog.*` keys).
 */

export type ThemeDesignKind = "mods" | "home" | "blog";

function nowSql(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function parseJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === "string") {
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

interface Row {
  doc: unknown;
  draft_doc: unknown;
}

async function readRow(siteId: string, themeId: string, kind: ThemeDesignKind): Promise<Row | null> {
  const db = await getDb();
  const rows = await db.query<Row>(
    "SELECT doc, draft_doc FROM theme_designs WHERE site_id = ? AND theme_id = ? AND kind = ? LIMIT 1",
    [siteId, themeId, kind],
  );
  return rows[0] ?? null;
}

export async function getThemeDesignDoc<T>(
  siteId: string,
  themeId: string,
  kind: ThemeDesignKind,
  opts: { draft?: boolean } = {},
): Promise<T | null> {
  const row = await readRow(siteId, themeId, kind);
  if (!row) return null;
  return parseJson<T>(opts.draft ? row.draft_doc : row.doc);
}

/** Both the published doc and the draft doc, in one read. */
export async function getThemeDesignDocs<T>(
  siteId: string,
  themeId: string,
  kind: ThemeDesignKind,
): Promise<{ doc: T | null; draft: T | null }> {
  const row = await readRow(siteId, themeId, kind);
  return {
    doc: row ? parseJson<T>(row.doc) : null,
    draft: row ? parseJson<T>(row.draft_doc) : null,
  };
}

export async function themeDesignHasDraft(
  siteId: string,
  themeId: string,
  kind: ThemeDesignKind,
): Promise<boolean> {
  const row = await readRow(siteId, themeId, kind);
  return row?.draft_doc != null && parseJson(row.draft_doc) != null;
}

async function upsert(
  siteId: string,
  themeId: string,
  kind: ThemeDesignKind,
  set: { doc?: unknown; draft_doc?: unknown | null },
): Promise<void> {
  const db = await getDb();
  const driver = process.env.DB_DRIVER as "postgres" | "mysql" | "mariadb" | undefined;
  const hasDoc = Object.prototype.hasOwnProperty.call(set, "doc");
  const hasDraft = Object.prototype.hasOwnProperty.call(set, "draft_doc");
  const docJson = hasDoc ? JSON.stringify(set.doc ?? {}) : null;
  const draftJson = hasDraft
    ? set.draft_doc == null
      ? null
      : JSON.stringify(set.draft_doc)
    : null;
  const stamp = nowSql();

  if (driver === "postgres") {
    await db.run(
      `INSERT INTO theme_designs (id, site_id, theme_id, kind, doc, draft_doc, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (site_id, theme_id, kind) DO UPDATE SET
         doc = ${hasDoc ? "EXCLUDED.doc" : "theme_designs.doc"},
         draft_doc = ${hasDraft ? "EXCLUDED.draft_doc" : "theme_designs.draft_doc"},
         updated_at = EXCLUDED.updated_at`,
      [randomUUID(), siteId, themeId, kind, docJson ?? "{}", draftJson, stamp, stamp],
    );
    return;
  }

  await db.run(
    `INSERT INTO theme_designs (id, site_id, theme_id, kind, doc, draft_doc, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       doc = ${hasDoc ? "VALUES(doc)" : "doc"},
       draft_doc = ${hasDraft ? "VALUES(draft_doc)" : "draft_doc"},
       updated_at = VALUES(updated_at)`,
    [randomUUID(), siteId, themeId, kind, docJson ?? "{}", draftJson, stamp, stamp],
  );
}

/** Write the working copy without touching the published doc. */
export async function saveThemeDesignDraft(
  siteId: string,
  themeId: string,
  kind: ThemeDesignKind,
  doc: unknown,
): Promise<void> {
  await upsert(siteId, themeId, kind, { draft_doc: doc });
}

/** Write the published doc without touching the draft. */
export async function saveThemeDesignPublished(
  siteId: string,
  themeId: string,
  kind: ThemeDesignKind,
  doc: unknown,
): Promise<void> {
  await upsert(siteId, themeId, kind, { doc });
}

/** Publish: set the published doc and drop any leftover draft. */
export async function publishThemeDesignDoc(
  siteId: string,
  themeId: string,
  kind: ThemeDesignKind,
  doc: unknown,
): Promise<void> {
  await upsert(siteId, themeId, kind, { doc, draft_doc: null });
}

export async function clearThemeDesignDraftDoc(
  siteId: string,
  themeId: string,
  kind: ThemeDesignKind,
): Promise<void> {
  await upsert(siteId, themeId, kind, { draft_doc: null });
}

/** Seed a row directly (used by the one-time settings → table migration). */
export async function seedThemeDesignRow(
  siteId: string,
  themeId: string,
  kind: ThemeDesignKind,
  doc: unknown,
  draft: unknown | null,
): Promise<void> {
  await upsert(siteId, themeId, kind, { doc, draft_doc: draft ?? null });
}
