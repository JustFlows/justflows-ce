import fs from "node:fs/promises";
import path from "node:path";
import { getJfCache, cacheStorageDir } from "./jf-cache.js";

export const PAGE_CACHE_PREFIX = "page:html:";
export const SITE_CTX_PREFIX = "site:ctx:";
export const THEME_MODS_PREFIX = "theme:mods:";
export const MENUS_PREFIX = "menus:";
export const CSS_PROVIDER_PREFIX = "css:provider:";

let defaultTtlSeconds = 300;

export async function publicCacheTtl(): Promise<number> {
  if (defaultTtlSeconds !== 300) return defaultTtlSeconds;
  try {
    const { loadConfig } = await import("@justflows/core");
    defaultTtlSeconds = loadConfig().cache.ttlSeconds;
  } catch {
    try {
      const ttl = parseInt(process.env.CACHE_TTL_SECONDS ?? "300", 10);
      if (Number.isFinite(ttl)) defaultTtlSeconds = ttl;
    } catch {
      // keep default
    }
  }
  return defaultTtlSeconds;
}

/** Cached full HTML page (skipped for preview / when cache disabled). */
export async function getCachedPageHtml(
  pageKey: string,
  preview: boolean,
  render: () => Promise<string>,
): Promise<string> {
  const cache = getJfCache();
  if (preview || !cache.enabled) {
    return render();
  }
  return cache.remember(`${PAGE_CACHE_PREFIX}${pageKey}`, await publicCacheTtl(), render);
}

/** Generic remember helper for public-site data. */
export async function rememberPublic<T>(
  key: string,
  fn: () => Promise<T>,
  preview = false,
): Promise<T> {
  const cache = getJfCache();
  if (preview || !cache.enabled) return fn();
  return cache.remember(key, await publicCacheTtl(), fn);
}

/** Wipe all public-site cache layers (content, pages, layout data). */
export async function invalidatePublicSiteCache(): Promise<void> {
  const { revalidateOnUpdate } = await import("./cache-revalidate.js");
  await revalidateOnUpdate("manual");
}

export async function inspectCacheStorage(): Promise<{
  keyCount: number;
  totalBytes: number;
  sampleKeys: string[];
}> {
  const cacheDir = cacheStorageDir();

  try {
    const entries = await fs.readdir(cacheDir);
    const jsonFiles = entries.filter((n) => n.endsWith(".json"));
    let totalBytes = 0;
    for (const name of jsonFiles) {
      const stat = await fs.stat(path.join(cacheDir, name));
      totalBytes += stat.size;
    }
    return {
      keyCount: jsonFiles.length,
      totalBytes,
      sampleKeys: jsonFiles.slice(0, 20),
    };
  } catch {
    return { keyCount: 0, totalBytes: 0, sampleKeys: [] };
  }
}
