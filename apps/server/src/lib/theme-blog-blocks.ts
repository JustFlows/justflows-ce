import { normalizeBlocks } from "./content-api.js";
import { loadThemeDemoBlog } from "./theme-files.js";
import { deleteSiteSetting, getSiteId, getSiteSetting, setSiteSetting } from "./site-settings.js";
import { getActiveTheme, themeInstalledPath } from "./themes-db.js";
import type { BlockDocument } from "./types.js";

function blogKey(themeId: string, draft = false): string {
  return draft ? `theme_blog_draft.${themeId}` : `theme_blog.${themeId}`;
}

export function defaultBlogBlocksFromTheme(themeId: string, installedPath?: string | null): BlockDocument {
  const blocks = loadThemeDemoBlog(themeId, installedPath) ?? [];
  return normalizeBlocks({ version: 1, blocks });
}

export async function getThemeBlogBlocks(themeId: string, draft = false): Promise<BlockDocument | null> {
  const siteId = await getSiteId();
  if (!siteId) return null;
  const stored = await getSiteSetting<BlockDocument>(siteId, blogKey(themeId, draft));
  return stored ? normalizeBlocks(stored) : null;
}

export async function saveThemeBlogBlocks(
  themeId: string,
  doc: BlockDocument,
  draft = false,
): Promise<void> {
  const siteId = await getSiteId();
  if (!siteId) throw new Error("No site found");
  await setSiteSetting(siteId, blogKey(themeId, draft), normalizeBlocks(doc));
}

export async function clearThemeBlogDraft(themeId: string): Promise<void> {
  const siteId = await getSiteId();
  if (!siteId) return;
  await deleteSiteSetting(siteId, blogKey(themeId, true));
}

export async function publishThemeBlogBlocks(themeId: string, doc: BlockDocument): Promise<void> {
  await saveThemeBlogBlocks(themeId, doc, false);
  await clearThemeBlogDraft(themeId);
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
