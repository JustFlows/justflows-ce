// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import { settingsKeyColumn } from "./site-settings.js";

/**
 * Per-user administration preferences. Same JSON row-per-key shape as
 * `site_settings`, but scoped to a user — so a choice like "dashboard welcome
 * panel dismissed" follows the account across browsers and devices rather than
 * living only in one browser's localStorage.
 *
 * `key` is a reserved word in MySQL and MariaDB but not in PostgreSQL, so the
 * reads borrow `settingsKeyColumn()` from site-settings and the writes branch
 * on the driver exactly as `setSiteSetting` does.
 */

function now(): string {
  return new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
}

export async function getUserPreference<T>(userId: string, key: string): Promise<T | null> {
  const db = await getDb();
  const rows = await db.query<{ value: string }>(
    `SELECT value FROM user_preferences WHERE user_id = ? AND ${settingsKeyColumn()} = ? LIMIT 1`,
    [userId, key],
  );
  if (!rows[0]?.value) return null;
  try {
    return JSON.parse(rows[0].value) as T;
  } catch {
    return rows[0].value as T;
  }
}

export async function getUserPreferences(userId: string): Promise<Record<string, unknown>> {
  const db = await getDb();
  const rows = await db.query<{ k: string; value: string | null }>(
    `SELECT ${settingsKeyColumn()} AS k, value FROM user_preferences WHERE user_id = ?`,
    [userId],
  );
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    if (row.value == null) continue;
    try {
      out[row.k] = JSON.parse(row.value);
    } catch {
      out[row.k] = row.value;
    }
  }
  return out;
}

export async function setUserPreference(
  userId: string,
  key: string,
  value: unknown,
): Promise<void> {
  const db = await getDb();
  const driver = process.env.DB_DRIVER as "postgres" | "mysql" | "mariadb" | undefined;
  const serialized = JSON.stringify(value);

  if (driver === "postgres") {
    await db.run(
      `INSERT INTO user_preferences (id, user_id, key, value, updated_at)
         VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [randomUUID(), userId, key, serialized, now()],
    );
    return;
  }

  await db.run(
    `INSERT INTO user_preferences (id, user_id, \`key\`, value, updated_at)
       VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)`,
    [randomUUID(), userId, key, serialized, now()],
  );
}

export async function deleteUserPreference(userId: string, key: string): Promise<void> {
  const db = await getDb();
  await db.run(`DELETE FROM user_preferences WHERE user_id = ? AND ${settingsKeyColumn()} = ?`, [
    userId,
    key,
  ]);
}
