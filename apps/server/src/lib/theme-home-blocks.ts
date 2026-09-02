import { normalizeBlocks } from "./content-api.js";
import { loadThemeDemoHome } from "./theme-files.js";
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

export function defaultHomeBlocksFromTheme(themeId: string, installedPath?: string | null): BlockDocument {
  const blocks = loadThemeDemoHome(themeId, installedPath) ?? [];
  return normalizeBlocks({ version: 1, blocks });
}

export async function getThemeHomeBlocks(themeId: string, draft = false): Promise<BlockDocument | null> {
  const siteId = await getSiteId();
  if (!siteId) return null;
  const stored = await getThemeDesignDoc<BlockDocument>(siteId, themeId, "home", { draft });
  return stored ? normalizeBlocks(stored) : null;
}

export async function saveThemeHomeBlocks(
  themeId: string,
  doc: BlockDocument,
  draft = false,
): Promise<void> {
  const siteId = await getSiteId();
  if (!siteId) throw new Error("No site found");
  const normalized = normalizeBlocks(doc);
  if (draft) {
    await saveThemeDesignDraft(siteId, themeId, "home", normalized);
  } else {
    await saveThemeDesignPublished(siteId, themeId, "home", normalized);
  }
}

export async function clearThemeHomeDraft(themeId: string): Promise<void> {
  const siteId = await getSiteId();
  if (!siteId) return;
  await clearThemeDesignDraftDoc(siteId, themeId, "home");
}

export async function publishThemeHomeBlocks(themeId: string, doc: BlockDocument): Promise<void> {
  const siteId = await getSiteId();
  if (!siteId) throw new Error("No site found");
  await publishThemeDesignDoc(siteId, themeId, "home", normalizeBlocks(doc));
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
