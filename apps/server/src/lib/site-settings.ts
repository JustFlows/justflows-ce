import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";

function now(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

/**
 * The `key` column, quoted for the active driver.
 *
 * `key` is a reserved word in MySQL and MariaDB but not in PostgreSQL, where a
 * backtick is a syntax error rather than a quote. setSiteSetting branched on
 * the driver for its INSERT; the reads did not, and hardcoded the MySQL form —
 * so every settings lookup was malformed SQL on PostgreSQL.
 */
export function settingsKeyColumn(): string {
  return process.env.DB_DRIVER === "postgres" ? "key" : "`key`";
}

export async function getSiteId(): Promise<string | null> {
  const db = await getDb();
  const rows = await db.query<{ id: string }>("SELECT id FROM sites LIMIT 1");
  return rows[0]?.id ?? null;
}

export async function getSiteSetting<T>(siteId: string, key: string): Promise<T | null> {
  const db = await getDb();
  const rows = await db.query<{ value: string }>(
    `SELECT value FROM site_settings WHERE site_id = ? AND ${settingsKeyColumn()} = ? LIMIT 1`,
    [siteId, key],
  );
  if (!rows[0]?.value) return null;
  try {
    return JSON.parse(rows[0].value) as T;
  } catch {
    return rows[0].value as T;
  }
}

export async function setSiteSetting(siteId: string, key: string, value: unknown): Promise<void> {
  const db = await getDb();
  const driver = process.env.DB_DRIVER as "postgres" | "mysql" | "mariadb" | undefined;
  const serialized = JSON.stringify(value);

  if (driver === "postgres") {
    await db.run(
      `INSERT INTO site_settings (id, site_id, key, value, updated_at)
         VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (site_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [randomUUID(), siteId, key, serialized, now()],
    );
    return;
  }

  await db.run(
    `INSERT INTO site_settings (id, site_id, \`key\`, value, updated_at)
       VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)`,
    [randomUUID(), siteId, key, serialized, now()],
  );
}

export async function deleteSiteSetting(siteId: string, key: string): Promise<void> {
  const db = await getDb();
  await db.run(`DELETE FROM site_settings WHERE site_id = ? AND ${settingsKeyColumn()} = ?`, [
    siteId,
    key,
  ]);
}
