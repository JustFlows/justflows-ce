// SPDX-License-Identifier: MIT
import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";

function sqlTime(date = new Date()): string {
  return date.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

export async function createDeviceSession(input: {
  userId: string; siteId: string; userAgent?: string | null; ip?: string | null;
}): Promise<string | undefined> {
  const id = randomUUID();
  const db = await getDb();
  await db.run(
    `INSERT INTO user_sessions
      (id, user_id, site_id, user_agent, ip, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.userId, input.siteId, input.userAgent?.slice(0, 255) ?? null, input.ip?.slice(0, 64) ?? null,
      sqlTime(), sqlTime(), sqlTime(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000))],
  );
  // Older installs and lightweight test adapters may accept an unknown INSERT
  // as a no-op. Do not issue a cookie that would immediately fail resolution.
  const persisted = await db.query<{ id: string }>(
    "SELECT id FROM user_sessions WHERE id = ? AND user_id = ? AND site_id = ? LIMIT 1",
    [id, input.userId, input.siteId],
  ).catch(() => []);
  return persisted[0]?.id;
}

export async function isDeviceSessionActive(id: string, userId: string, siteId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query<{ id: string }>(
    "SELECT id FROM user_sessions WHERE id = ? AND user_id = ? AND site_id = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1",
    [id, userId, siteId, sqlTime()],
  );
  if (!rows[0]) return false;
  void db.run("UPDATE user_sessions SET last_seen_at = ? WHERE id = ?", [sqlTime(), id]);
  return true;
}

export async function revokeDeviceSession(id: string, userId: string, siteId: string): Promise<boolean> {
  const db = await getDb();
  return (await db.execute(
    "UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND site_id = ? AND revoked_at IS NULL",
    [sqlTime(), id, userId, siteId],
  )) > 0;
}

export async function revokeOtherDeviceSessions(currentId: string, userId: string, siteId: string): Promise<number> {
  const db = await getDb();
  return db.execute(
    "UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND site_id = ? AND id <> ? AND revoked_at IS NULL",
    [sqlTime(), userId, siteId, currentId],
  );
}

export async function listDeviceSessions(userId: string, siteId: string, currentId?: string) {
  const db = await getDb();
  const rows = await db.query<Record<string, unknown>>(
    `SELECT id, user_agent, ip, created_at, last_seen_at, expires_at
       FROM user_sessions
      WHERE user_id = ? AND site_id = ? AND revoked_at IS NULL AND expires_at > ?
      ORDER BY last_seen_at DESC`,
    [userId, siteId, sqlTime()],
  );
  return rows.map((row) => ({ ...row, current: row.id === currentId }));
}
