import { getDb } from "./db.js";
import { serializeContentRow, type ContentResponse } from "./content-api.js";
import { resolveContentLocale } from "./i18n/languages-db.js";
import { getJfCache } from "./jf-cache.js";

const CONTENT_CACHE_PREFIX = "content:";

let defaultTtlSeconds = 300;

/** Resolve TTL from config once per process (falls back to 300s pre-install). */
async function contentCacheTtl(): Promise<number> {
  if (defaultTtlSeconds !== 300) return defaultTtlSeconds;
  try {
    const { loadConfig } = await import("@justflows/core");
    defaultTtlSeconds = loadConfig().cache.ttlSeconds;
  } catch {
    // keep default
  }
  return defaultTtlSeconds;
}

import { revalidateOnUpdate } from "./cache-revalidate.js";

export async function invalidateContentCache(): Promise<void> {
  await revalidateOnUpdate("content");
}

async function fetchPublishedContentBySlug(
  slug: string,
  requestedLocale?: string,
): Promise<ContentResponse | null> {
  const db = await getDb();
  const sites = await db.query<{ id: string }>("SELECT id FROM sites LIMIT 1");
  const siteId = sites[0]?.id;
  if (!siteId) return null;

  const locale = await resolveContentLocale(requestedLocale, siteId);

  const rows = await db.query<Record<string, unknown>>(
    "SELECT * FROM content WHERE site_id = ? AND slug = ? AND locale = ? AND status = 'published' LIMIT 1",
    [siteId, slug, locale],
  );

  return rows[0] ? serializeContentRow(rows[0]) : null;
}

export async function getPublishedContentBySlug(
  slug: string,
  requestedLocale?: string,
): Promise<ContentResponse | null> {
  const cacheKey = `${CONTENT_CACHE_PREFIX}published:${slug}:${requestedLocale ?? ""}`;

  return getJfCache().remember(cacheKey, await contentCacheTtl(), () =>
    fetchPublishedContentBySlug(slug, requestedLocale),
  );
}

async function fetchTranslationAlternates(
  translationGroupId: string,
): Promise<Array<{ locale: string; slug: string }>> {
  const db = await getDb();
  const rows = await db.query<{ locale: string; slug: string }>(
    "SELECT locale, slug FROM content WHERE translation_group_id = ? AND status = 'published'",
    [translationGroupId],
  );
  return rows.map((r) => ({ locale: String(r.locale), slug: String(r.slug) }));
}

export async function getTranslationAlternates(
  translationGroupId: string,
): Promise<Array<{ locale: string; slug: string }>> {
  const cacheKey = `${CONTENT_CACHE_PREFIX}alternates:${translationGroupId}`;

  return getJfCache().remember(cacheKey, await contentCacheTtl(), () =>
    fetchTranslationAlternates(translationGroupId),
  );
}

export async function listPublishedContent(siteId: string): Promise<ContentResponse[]> {
  const cacheKey = `${CONTENT_CACHE_PREFIX}published-list:${siteId}`;
  return getJfCache().remember(cacheKey, await contentCacheTtl(), async () => {
    const db = await getDb();
    const rows = await db.query<Record<string, unknown>>(
      "SELECT * FROM content WHERE site_id = ? AND status = 'published' ORDER BY updated_at DESC",
      [siteId],
    );
    return rows.map((row) => serializeContentRow(row));
  });
}
