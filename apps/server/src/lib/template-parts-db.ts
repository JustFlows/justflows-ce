// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";

/**
 * Storage for site-wide chrome documents (header library, footer blocks) in the
 * dedicated `template_parts` table. One row per (site, part): `doc` is the
 * published document, `draft_doc` the unpublished working copy (NULL when none).
 *
 * The document shape is the caller's concern — this layer only reads and writes
 * JSON. See `template-parts.ts` (footer) and `site-header.ts` (header).
 */

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

async function readRow(siteId: string, part: string): Promise<Row | null> {
  const db = await getDb();
  const rows = await db.query<Row>(
    "SELECT doc, draft_doc FROM template_parts WHERE site_id = ? AND part = ? LIMIT 1",
    [siteId, part],
  );
  return rows[0] ?? null;
}

export async function getTemplatePartDoc<T>(
  siteId: string,
  part: string,
  opts: { draft?: boolean } = {},
): Promise<T | null> {
  const row = await readRow(siteId, part);
  if (!row) return null;
  return parseJson<T>(opts.draft ? row.draft_doc : row.doc);
}

/** Both the published doc and the draft doc, in one read. */
export async function getTemplatePartDocs<T>(
  siteId: string,
  part: string,
): Promise<{ doc: T | null; draft: T | null }> {
  const row = await readRow(siteId, part);
  return {
    doc: row ? parseJson<T>(row.doc) : null,
    draft: row ? parseJson<T>(row.draft_doc) : null,
  };
}

export async function templatePartHasDraft(siteId: string, part: string): Promise<boolean> {
  const row = await readRow(siteId, part);
  return row?.draft_doc != null && parseJson(row.draft_doc) != null;
}

async function upsert(
  siteId: string,
  part: string,
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
      `INSERT INTO template_parts (id, site_id, part, doc, draft_doc, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (site_id, part) DO UPDATE SET
         doc = ${hasDoc ? "EXCLUDED.doc" : "template_parts.doc"},
         draft_doc = ${hasDraft ? "EXCLUDED.draft_doc" : "template_parts.draft_doc"},
         updated_at = EXCLUDED.updated_at`,
      [randomUUID(), siteId, part, docJson ?? "{}", draftJson, stamp, stamp],
    );
    return;
  }

  await db.run(
    `INSERT INTO template_parts (id, site_id, part, doc, draft_doc, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       doc = ${hasDoc ? "VALUES(doc)" : "doc"},
       draft_doc = ${hasDraft ? "VALUES(draft_doc)" : "draft_doc"},
       updated_at = VALUES(updated_at)`,
    [randomUUID(), siteId, part, docJson ?? "{}", draftJson, stamp, stamp],
  );
}

/** Write the working copy without touching the published doc. */
export async function saveTemplatePartDraft(siteId: string, part: string, doc: unknown): Promise<void> {
  await upsert(siteId, part, { draft_doc: doc });
}

/** Write the published doc without touching the draft. */
export async function saveTemplatePartPublished(siteId: string, part: string, doc: unknown): Promise<void> {
  await upsert(siteId, part, { doc });
}

/** Publish: set the published doc and drop any leftover draft. */
export async function publishTemplatePartDoc(siteId: string, part: string, doc: unknown): Promise<void> {
  await upsert(siteId, part, { doc, draft_doc: null });
}

export async function clearTemplatePartDraftDoc(siteId: string, part: string): Promise<void> {
  await upsert(siteId, part, { draft_doc: null });
}

/** Seed a row directly (used by the one-time settings → table migration). */
export async function seedTemplatePartRow(
  siteId: string,
  part: string,
  doc: unknown,
  draft: unknown | null,
): Promise<void> {
  await upsert(siteId, part, { doc, draft_doc: draft ?? null });
}
