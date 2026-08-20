import { normalizeBlocks } from "./content-api.js";
import { loadThemeDemoHome } from "./theme-files.js";
import { deleteSiteSetting, getSiteId, getSiteSetting, setSiteSetting } from "./site-settings.js";
import { getActiveTheme, themeInstalledPath } from "./themes-db.js";
import type { BlockDocument } from "./types.js";

function homeKey(themeId: string, draft = false): string {
  return draft ? `theme_home_draft.${themeId}` : `theme_home.${themeId}`;
}

export function defaultHomeBlocksFromTheme(themeId: string, installedPath?: string | null): BlockDocument {
  const blocks = loadThemeDemoHome(themeId, installedPath) ?? [];
  return normalizeBlocks({ version: 1, blocks });
}

export async function getThemeHomeBlocks(themeId: string, draft = false): Promise<BlockDocument | null> {
  const siteId = await getSiteId();
  if (!siteId) return null;
  const stored = await getSiteSetting<BlockDocument>(siteId, homeKey(themeId, draft));
  return stored ? normalizeBlocks(stored) : null;
}

export async function saveThemeHomeBlocks(
  themeId: string,
  doc: BlockDocument,
  draft = false,
): Promise<void> {
  const siteId = await getSiteId();
  if (!siteId) throw new Error("No site found");
  await setSiteSetting(siteId, homeKey(themeId, draft), normalizeBlocks(doc));
}

export async function clearThemeHomeDraft(themeId: string): Promise<void> {
  const siteId = await getSiteId();
  if (!siteId) return;
  await deleteSiteSetting(siteId, homeKey(themeId, true));
}

export async function publishThemeHomeBlocks(themeId: string, doc: BlockDocument): Promise<void> {
  await saveThemeHomeBlocks(themeId, doc, false);
  await clearThemeHomeDraft(themeId);
}

/** Resolve homepage blocks for the editor or public site. */
export async function getEffectiveHomeBlocks(themeId: string, preview = false): Promise<BlockDocument> {
  const siteId = await getSiteId();
  const theme = siteId ? await getActiveTheme(siteId) : null;
  const installedPath = theme?.theme_id === themeId ? themeInstalledPath(theme) : null;
  const defaults = defaultHomeBlocksFromTheme(themeId, installedPath);
  const published = await getThemeHomeBlocks(themeId, false);
  const draft = preview ? await getThemeHomeBlocks(themeId, true) : null;

  if (preview && draft?.blocks.length) return draft;
  if (published?.blocks.length) return published;
  return defaults;
}
