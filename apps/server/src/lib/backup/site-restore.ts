// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import type { DbClient } from "../database/db.js";
import { getUploadStore, isSafeUploadKey } from "../media/upload-store.js";
import type { PortableBackupEnvelope } from "./portable-archive.js";

const RESTORE_ORDER = [
  "languages",
  "content_types",
  "site_settings",
  "template_parts",
  "theme_designs",
  "theme_templates",
  "redirects",
  "comment_moderation_rules",
  "comment_spam_terms",
  "taxonomies",
  "terms",
  "content",
  "revisions",
  "content_terms",
  "menus",
  "media",
  "comments",
] as const;

const DELETE_ORDER = [...RESTORE_ORDER].reverse();
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const OMIT_COLUMNS = new Set(["password_hash", "site_id"]);
const NULL_USER_COLUMNS = new Set(["author_id", "created_by", "uploaded_by", "user_id"]);
const SENSITIVE_SETTING_KEY = /(secret|password|credential|private.?key|access.?token|refresh.?token|api.?key)/i;

function parentsFirst(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const pending = [...rows];
  const available = new Set(rows.map((row) => String(row.id ?? "")));
  const inserted = new Set<string>();
  const ordered: Record<string, unknown>[] = [];
  while (pending.length > 0) {
    const index = pending.findIndex((row) => !row.parent_id || !available.has(String(row.parent_id)) || inserted.has(String(row.parent_id)));
    if (index < 0) throw new Error("Backup contains a cyclic parent relationship");
    const row = pending.splice(index, 1)[0];
    if (!row) throw new Error("Backup parent ordering failed");
    ordered.push(row);
    inserted.add(String(row.id ?? ""));
  }
  return ordered;
}

function sqlValue(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

async function insertRows(
  tx: Pick<DbClient, "run">,
  table: string,
  rows: Record<string, unknown>[],
  siteId: string,
  mediaKeys: Map<string, string>,
): Promise<void> {
  if (!RESTORE_ORDER.includes(table as (typeof RESTORE_ORDER)[number])) throw new Error("Unsupported restore table");
  for (const source of table === "terms" || table === "comments" ? parentsFirst(rows) : rows) {
    const row: Record<string, unknown> = { ...source };
    if (table !== "content_terms") row.site_id = siteId;
    for (const column of NULL_USER_COLUMNS) if (column in row) row[column] = null;
    if (table === "media") {
      const original = String(row.storage_key ?? "");
      const replacement = mediaKeys.get(original);
      if (!replacement) throw new Error("Media record has no verified backup file");
      row.storage_key = replacement;
      row.url = `/uploads/${replacement}`;
    }
    const columns = Object.keys(row).filter((column) => IDENTIFIER.test(column) && !OMIT_COLUMNS.has(column));
    if (table !== "content_terms") columns.push("site_id");
    if (columns.length === 0) continue;
    await tx.run(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      columns.map((column) => sqlValue(row[column])),
    );
  }
}

/** Restore is intentionally limited to a site with no user content. */
export async function assertCleanRestoreTarget(db: DbClient, siteId: string): Promise<void> {
  const rows = await db.query<{ item_count: string | number }>(
    `SELECT (
      (SELECT COUNT(*) FROM content WHERE site_id = ?) +
      (SELECT COUNT(*) FROM media WHERE site_id = ?) +
      (SELECT COUNT(*) FROM comments WHERE site_id = ?) +
      (SELECT COUNT(*) FROM menus WHERE site_id = ?)
    ) AS item_count`,
    [siteId, siteId, siteId, siteId],
  );
  if (Number(rows[0]?.item_count ?? 0) !== 0) throw new Error("Restore requires a clean site with no content, media, comments, or menus");
}

/** Stage verified media, replace clean-site data transactionally, and remove staged files on failure. */
export async function restoreSiteBackup(db: DbClient, siteId: string, backup: PortableBackupEnvelope): Promise<void> {
  await assertCleanRestoreTarget(db, siteId);
  const targetSettings = await db.query<Record<string, unknown>>("SELECT * FROM site_settings WHERE site_id = ?", [siteId]);
  const preservedSettings = targetSettings.filter((row) => SENSITIVE_SETTING_KEY.test(String(row.key ?? "")));
  const store = getUploadStore();
  const restoreId = randomUUID();
  const staged: { temporary: string; final: string }[] = [];
  const mediaKeys = new Map<string, string>();
  try {
    for (const file of backup.data.files) {
      const prefix = `${backup.source.siteId}/`;
      if (!file.key.startsWith(prefix)) throw new Error("Backup media does not belong to its source site");
      const suffix = file.key.slice(prefix.length);
      const final = `${siteId}/${suffix}`;
      const temporary = `${siteId}/.restore/${restoreId}/${suffix}`;
      if (!isSafeUploadKey(final) || !isSafeUploadKey(temporary)) throw new Error("Backup contains an unsafe media key");
      await store.put(temporary, Buffer.from(file.data, "base64"), file.mimeType);
      staged.push({ temporary, final });
      mediaKeys.set(file.key, final);
    }

    await db.transaction(async (tx) => {
      for (const table of DELETE_ORDER) {
        if (table === "content_terms") {
          await tx.run("DELETE FROM content_terms WHERE content_id IN (SELECT id FROM content WHERE site_id = ?)", [siteId]);
        } else {
          await tx.run(`DELETE FROM ${table} WHERE site_id = ?`, [siteId]);
        }
      }
      for (const table of RESTORE_ORDER) {
        await insertRows(tx, table, backup.data.tables[table] ?? [], siteId, mediaKeys);
      }
      await insertRows(tx, "site_settings", preservedSettings, siteId, mediaKeys);
      for (const file of staged) {
        if (!(await store.move(file.temporary, file.final))) throw new Error("Could not activate restored media");
      }
    });
  } catch (error) {
    await Promise.allSettled(staged.flatMap((file) => [store.delete(file.temporary), store.delete(file.final)]));
    throw error;
  }
}
