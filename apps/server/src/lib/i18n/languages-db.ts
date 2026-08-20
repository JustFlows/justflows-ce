import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { getSiteId } from "../site-settings.js";
import { metaForCode, normalizeLocale, type LanguageMeta } from "./locales.js";

export interface LanguageRow {
  id: string;
  site_id: string;
  code: string;
  name: string;
  native_name: string;
  is_default: boolean | number;
  is_active: boolean | number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Language {
  id: string;
  code: string;
  name: string;
  nativeName: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}

function now(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function toBool(v: boolean | number | string): boolean {
  return v === true || v === 1 || v === "1" || v === "t";
}

function serialize(row: LanguageRow): Language {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    nativeName: String(row.native_name),
    isDefault: toBool(row.is_default),
    isActive: toBool(row.is_active),
    sortOrder: Number(row.sort_order ?? 0),
  };
}

export async function ensureDefaultLanguages(siteId?: string): Promise<void> {
  const sid = siteId ?? (await getSiteId());
  if (!sid) return;

  const db = await getDb();
  const existing = await db.query<{ id: string }>(
    "SELECT id FROM languages WHERE site_id = ? LIMIT 1",
    [sid],
  );
  if (existing[0]) return;

  const en = metaForCode("en");
  await db.run(
    `INSERT INTO languages (id, site_id, code, name, native_name, is_default, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, 1, 0, ?, ?)`,
    [randomUUID(), sid, en.code, en.name, en.nativeName, now(), now()],
  );
}

export async function listLanguages(siteId?: string, activeOnly = false): Promise<Language[]> {
  const sid = siteId ?? (await getSiteId());
  if (!sid) return [];

  await ensureDefaultLanguages(sid);
  const db = await getDb();

  let sql = "SELECT * FROM languages WHERE site_id = ?";
  const params: (string | number | boolean | null)[] = [sid];
  if (activeOnly) {
    sql += " AND is_active = ?";
    params.push(process.env.DB_DRIVER === "postgres" ? true : 1);
  }
  sql += " ORDER BY sort_order ASC, code ASC";

  const rows = await db.query<LanguageRow>(sql, params);
  return rows.map(serialize);
}

export async function getDefaultLocale(siteId?: string): Promise<string> {
  const langs = await listLanguages(siteId, true);
  const def = langs.find((l) => l.isDefault);
  return def?.code ?? langs[0]?.code ?? "en";
}

export async function getActiveLocaleCodes(siteId?: string): Promise<string[]> {
  const langs = await listLanguages(siteId, true);
  return langs.map((l) => l.code);
}

export async function addLanguage(
  siteId: string,
  input: { code: string; name?: string; nativeName?: string },
): Promise<Language> {
  const code = normalizeLocale(input.code);
  if (!code) throw new Error("Invalid locale code");

  const meta: LanguageMeta = input.name
    ? { code, name: input.name, nativeName: input.nativeName ?? input.name }
    : metaForCode(code);

  const db = await getDb();
  const id = randomUUID();
  const sortOrder = (await listLanguages(siteId)).length;

  await db.run(
    `INSERT INTO languages (id, site_id, code, name, native_name, is_default, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`,
    [id, siteId, meta.code, meta.name, meta.nativeName, sortOrder, now(), now()],
  );

  const rows = await db.query<LanguageRow>("SELECT * FROM languages WHERE id = ? LIMIT 1", [id]);
  return serialize(rows[0]!);
}

export async function setDefaultLanguageByCode(siteId: string, code: string): Promise<void> {
  const normalized = normalizeLocale(code);
  if (!normalized) throw new Error("Invalid locale code");

  let langs = await listLanguages(siteId);
  let target = langs.find((l) => l.code === normalized);
  if (!target) {
    target = await addLanguage(siteId, { code: normalized });
    langs = await listLanguages(siteId);
    target = langs.find((l) => l.id === target!.id) ?? target;
  }
  if (!target.isActive) {
    await updateLanguage(siteId, target.id, { isActive: true });
  }
  await setDefaultLanguage(siteId, target.id);
}

export async function setDefaultLanguage(siteId: string, languageId: string): Promise<void> {
  const db = await getDb();
  await db.run("UPDATE languages SET is_default = 0, updated_at = ? WHERE site_id = ?", [now(), siteId]);

  const isDefault = process.env.DB_DRIVER === "postgres" ? true : 1;
  await db.run("UPDATE languages SET is_default = ?, updated_at = ? WHERE id = ? AND site_id = ?", [
    isDefault,
    now(),
    languageId,
    siteId,
  ]);
}

export async function updateLanguage(
  siteId: string,
  languageId: string,
  patch: { isActive?: boolean; sortOrder?: number; name?: string; nativeName?: string },
): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: (string | number | boolean | null)[] = [];

  if (patch.isActive !== undefined) {
    fields.push("is_active = ?");
    values.push(process.env.DB_DRIVER === "postgres" ? patch.isActive : patch.isActive ? 1 : 0);
  }
  if (patch.sortOrder !== undefined) {
    fields.push("sort_order = ?");
    values.push(patch.sortOrder);
  }
  if (patch.name !== undefined) {
    fields.push("name = ?");
    values.push(patch.name);
  }
  if (patch.nativeName !== undefined) {
    fields.push("native_name = ?");
    values.push(patch.nativeName);
  }

  if (fields.length === 0) return;

  fields.push("updated_at = ?");
  values.push(now(), languageId, siteId);
  await db.run(`UPDATE languages SET ${fields.join(", ")} WHERE id = ? AND site_id = ?`, values);
}

export async function deleteLanguage(siteId: string, languageId: string): Promise<void> {
  const langs = await listLanguages(siteId);
  const target = langs.find((l) => l.id === languageId);
  if (!target) throw new Error("Language not found");
  if (target.isDefault) throw new Error("Cannot delete the default language");

  const db = await getDb();
  await db.run("DELETE FROM languages WHERE id = ? AND site_id = ?", [languageId, siteId]);
}

export async function resolveContentLocale(
  requested: string | undefined | null,
  siteId?: string,
): Promise<string> {
  const active = await getActiveLocaleCodes(siteId);
  const normalized = normalizeLocale(requested ?? undefined);
  if (normalized && active.includes(normalized)) return normalized;

  const baseMatch = normalized
    ? active.find((c) => c.split("-")[0] === normalized.split("-")[0])
    : undefined;
  if (baseMatch) return baseMatch;

  return await getDefaultLocale(siteId);
}
