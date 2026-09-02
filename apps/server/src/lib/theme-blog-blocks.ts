import { normalizeBlocks } from "./content-api.js";
import { loadThemeDemoBlog } from "./theme-files.js";
import { getSiteId } from "./site-settings.js";
import {
  clearThemeDesignDraftDoc,
  getThemeDesignDoc,
  publishThemeDesignDoc,
  saveThemeDesignDraft,
  saveThemeDesignPublished,
} from "./theme-designs-db.js";
import { getActiveTheme, themeInstalledPath } from "./themes-db.js";
import type { BlockDocument } from "./types.js";

export function defaultBlogBlocksFromTheme(themeId: string, installedPath?: string | null): BlockDocument {
  const blocks = loadThemeDemoBlog(themeId, installedPath) ?? [];
  return normalizeBlocks({ version: 1, blocks });
}

export async function getThemeBlogBlocks(themeId: string, draft = false): Promise<BlockDocument | null> {
  const siteId = await getSiteId();
  if (!siteId) return null;
  const stored = await getThemeDesignDoc<BlockDocument>(siteId, themeId, "blog", { draft });
  return stored ? normalizeBlocks(stored) : null;
}

export async function saveThemeBlogBlocks(
  themeId: string,
  doc: BlockDocument,
  draft = false,
): Promise<void> {
  const siteId = await getSiteId();
  if (!siteId) throw new Error("No site found");
  const normalized = normalizeBlocks(doc);
  if (draft) {
    await saveThemeDesignDraft(siteId, themeId, "blog", normalized);
  } else {
    await saveThemeDesignPublished(siteId, themeId, "blog", normalized);
  }
}

export async function clearThemeBlogDraft(themeId: string): Promise<void> {
  const siteId = await getSiteId();
  if (!siteId) return;
  await clearThemeDesignDraftDoc(siteId, themeId, "blog");
}

export async function publishThemeBlogBlocks(themeId: string, doc: BlockDocument): Promise<void> {
  const siteId = await getSiteId();
  if (!siteId) throw new Error("No site found");
  await publishThemeDesignDoc(siteId, themeId, "blog", normalizeBlocks(doc));
}

/** Resolve the default blog design for the theme customizer editor/preview. */
export async function getEffectiveBlogBlocks(themeId: string, preview = false): Promise<BlockDocument> {
  const siteId = await getSiteId();
  const theme = siteId ? await getActiveTheme(siteId) : null;
  const installedPath = theme?.theme_id === themeId ? themeInstalledPath(theme) : null;
  const defaults = defaultBlogBlocksFromTheme(themeId, installedPath);
  const published = await getThemeBlogBlocks(themeId, false);
  const draft = preview ? await getThemeBlogBlocks(themeId, true) : null;

  if (preview && draft?.blocks.length) return draft;
  if (published?.blocks.length) return published;
  return defaults;
}
