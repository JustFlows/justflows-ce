/**
 * Thin data-access helpers for the themes table.
 * Uses the same DbClient as the rest of the admin app (postgres or mysql2).
 */

import { getDb } from "./db.js";
import { runAllMigrations } from "./run-migrations.js";
import { DEFAULT_THEME_CSS_VARS } from "./theme-customize.js";
import { randomUUID } from "node:crypto";

export interface ThemeRow {
  id: string;
  site_id: string;
  theme_id: string;
  name: string;
  version: string;
  publisher: string;
  description: string | null;
  status: "installed" | "active" | "inactive" | "error";
  css_variables: Record<string, string>;
  manifest: Record<string, unknown>;
  installed_at: string;
  activated_at: string | null;
  updated_at: string;
}

/** Run the themes migration if the table doesn't exist yet (idempotent). */
export async function ensureThemesTable(): Promise<void> {
  const db = await getDb();
  const driver = process.env.DB_DRIVER as "postgres" | "mysql" | "mariadb";
  await runAllMigrations(db, driver);
}

export async function getSiteId(): Promise<string | null> {
  const db = await getDb();
  const rows = await db.query<{ id: string }>("SELECT id FROM sites LIMIT 1");
  return rows[0]?.id ?? null;
}

export async function ensureDefaultTheme(siteId: string): Promise<void> {
  const db = await getDb();
  const existing = await db.query<{ id: string }>(
    "SELECT id FROM themes WHERE site_id = ? LIMIT 1",
    [siteId],
  );
  if (existing[0]) return;

  const themeId = "justflows.default";
  await db.run(
    `INSERT INTO themes
       (id, site_id, theme_id, name, version, publisher, description,
        status, css_variables, manifest, installed_at, activated_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      siteId,
      themeId,
      "Default",
      "1.0.0",
      "Justflows",
      "The official Justflows starter theme",
      JSON.stringify(DEFAULT_THEME_CSS_VARS),
      JSON.stringify({ id: themeId, type: "theme", name: "Default" }),
      now(),
      now(),
      now(),
    ],
  );
}

export async function listThemes(siteId: string): Promise<ThemeRow[]> {
  await ensureDefaultTheme(siteId);
  const db = await getDb();
  const rows = await db.query<ThemeRow>(
    "SELECT * FROM themes WHERE site_id = ? ORDER BY installed_at DESC",
    [siteId],
  );
  return rows.map(parseThemeRow);
}

export function themeInstalledPath(theme: ThemeRow | null | undefined): string | null {
  const pathValue = theme?.manifest?.installedPath;
  return typeof pathValue === "string" && pathValue.length > 0 ? pathValue : null;
}

export async function getActiveTheme(siteId: string): Promise<ThemeRow | null> {
  await ensureDefaultTheme(siteId);
  const db = await getDb();
  const rows = await db.query<ThemeRow>(
    "SELECT * FROM themes WHERE site_id = ? AND status = 'active' LIMIT 1",
    [siteId],
  );
  return rows[0] ? parseThemeRow(rows[0]) : null;
}

export async function insertTheme(
  siteId: string,
  theme: {
    id: string;
    themeId: string;
    name: string;
    version: string;
    publisher: string;
    description?: string;
    cssVariables: Record<string, string>;
    manifest: Record<string, unknown>;
  },
): Promise<void> {
  const db = await getDb();
  await db.run(
    `INSERT INTO themes
       (id, site_id, theme_id, name, version, publisher, description,
        status, css_variables, manifest, installed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'installed', ?, ?, ?, ?)`,
    [
      theme.id,
      siteId,
      theme.themeId,
      theme.name,
      theme.version,
      theme.publisher,
      theme.description ?? null,
      JSON.stringify(theme.cssVariables),
      JSON.stringify(theme.manifest),
      now(),
      now(),
    ],
  );
}

export async function activateTheme(siteId: string, themeId: string): Promise<boolean> {
  const db = await getDb();

  // Deactivate all other themes for this site
  await db.run(
    `UPDATE themes SET status = 'inactive', updated_at = ?
     WHERE site_id = ? AND status = 'active'`,
    [now(), siteId],
  );

  // Activate the chosen theme
  const result = await db.query<{ count: number }>(
    `UPDATE themes SET status = 'active', activated_at = ?, updated_at = ?
     WHERE site_id = ? AND theme_id = ?`,
    [now(), now(), siteId, themeId],
  );

  // Update site_settings active_theme key (driver-aware upsert)
  const driver = process.env.DB_DRIVER as "postgres" | "mysql" | "mariadb" | undefined;
  if (driver === "postgres") {
    await db.run(
      `INSERT INTO site_settings (id, site_id, key, value, updated_at)
         VALUES (?, ?, 'active_theme', ?, ?)
       ON CONFLICT (site_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [crypto.randomUUID(), siteId, JSON.stringify(themeId), now()],
    );
  } else {
    await db.run(
      `INSERT INTO site_settings (id, site_id, \`key\`, value, updated_at)
         VALUES (?, ?, 'active_theme', ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)`,
      [crypto.randomUUID(), siteId, JSON.stringify(themeId), now()],
    );
  }

  return Array.isArray(result) && result.length > 0;
}

function parseThemeRow(row: ThemeRow): ThemeRow {
  return {
    ...row,
    css_variables:
      typeof row.css_variables === "string"
        ? JSON.parse(row.css_variables)
        : row.css_variables ?? {},
    manifest:
      typeof row.manifest === "string"
        ? JSON.parse(row.manifest)
        : row.manifest ?? {},
  };
}

function now(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}
