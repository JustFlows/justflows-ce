// SPDX-License-Identifier: MIT

/**
 * Bridges the template hierarchy, per-site overrides ({@link theme-templates-store.ts}),
 * and the theme's own files for the public site: given a {@link TemplateQuery}
 * it returns the block document to render for this request, or `null` when
 * nothing matches and the caller should fall back to the built-in EJS view.
 */

import { getActiveTheme, getSiteId, themeInstalledPath } from "./themes-db.js";
import { loadThemeTemplatePart } from "./theme-files.js";
import {
  getStoredTemplate,
  resolveEffectiveTemplate,
  type ResolvedTemplate,
} from "./theme-templates-store.js";
import { type TemplatePartSlot, type TemplateQuery } from "./template-hierarchy.js";
import type { BlockNode } from "./types.js";

export type PublicTemplate = ResolvedTemplate;

async function activeThemeRef(): Promise<{
  siteId: string | null;
  themeId: string;
  installedPath: string | null;
}> {
  const siteId = await getSiteId();
  const theme = siteId ? await getActiveTheme(siteId) : null;
  return {
    siteId,
    themeId: theme?.theme_id ?? "justflows.default",
    installedPath: theme ? themeInstalledPath(theme) : null,
  };
}

/** The template to render for this request, or `null` for the EJS fallback. */
export async function resolvePublicTemplate(
  query: TemplateQuery,
  preview = false,
): Promise<PublicTemplate | null> {
  const { siteId, themeId, installedPath } = await activeThemeRef();
  return resolveEffectiveTemplate(siteId, themeId, installedPath, query, preview);
}

/**
 * A template part's blocks (`header` / `footer`): a per-site override
 * (`parts/<slug>` stored via the same table) beats the theme's `parts/<slug>.json`.
 */
export async function resolveThemePartBlocks(
  slug: TemplatePartSlot,
  preview = false,
): Promise<BlockNode[] | null> {
  const { siteId, themeId, installedPath } = await activeThemeRef();
  if (siteId) {
    const key = `part-${slug}`;
    if (preview) {
      const draft = await getStoredTemplate(siteId, themeId, key, true);
      if (draft?.length) return draft;
    }
    const published = await getStoredTemplate(siteId, themeId, key, false);
    if (published?.length) return published;
  }
  return loadThemeTemplatePart(themeId, slug, installedPath);
}
