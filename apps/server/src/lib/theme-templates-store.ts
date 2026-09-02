// SPDX-License-Identifier: MIT

/**
 * The editing + resolution layer for theme templates, sitting between the
 * `theme_templates` table ({@link theme-templates-db.ts}), the theme's own
 * `templates/*.json` files ({@link theme-files.ts}), and the public renderer.
 *
 * Resolution for a request (see {@link resolveEffectiveTemplate}) walks the
 * template hierarchy candidate list and, per slug, prefers a per-site override
 * over the theme's file — so a theme's `single-post.json` still beats a site's
 * customised `single`, exactly like WordPress.
 */

import { sanitizeBlockDocument } from "@justflows/blocks";
import {
  clearThemeTemplateDraftDoc,
  deleteThemeTemplateRow,
  getThemeTemplateDoc,
  getThemeTemplateDocs,
  listOverriddenTemplateSlugs,
  publishThemeTemplateDoc,
  saveThemeTemplateDraft,
  saveThemeTemplatePublished,
  themeTemplateHasDraft,
} from "./theme-templates-db.js";
import { listThemeTemplateSlugs, loadThemeTemplate } from "./theme-files.js";
import { templateCandidates, type TemplateQuery } from "./template-hierarchy.js";
import type { BlockNode } from "./types.js";

const TEMPLATE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

export function isTemplateSlug(value: unknown): value is string {
  return typeof value === "string" && TEMPLATE_SLUG_RE.test(value);
}

interface StoredTemplateDoc {
  version: 1;
  blocks?: unknown;
}

function toBlocks(doc: StoredTemplateDoc | null): BlockNode[] | null {
  if (!doc) return null;
  return sanitizeBlockDocument({ version: 1, blocks: doc.blocks }).blocks as BlockNode[];
}

/** A per-site override's blocks (published, or the draft), or null when none. */
export async function getStoredTemplate(
  siteId: string,
  themeId: string,
  slug: string,
  draft = false,
): Promise<BlockNode[] | null> {
  return toBlocks(await getThemeTemplateDoc<StoredTemplateDoc>(siteId, themeId, slug, { draft }));
}

export async function getStoredTemplateDocs(
  siteId: string,
  themeId: string,
  slug: string,
): Promise<{ published: BlockNode[] | null; draft: BlockNode[] | null }> {
  const { doc, draft } = await getThemeTemplateDocs<StoredTemplateDoc>(siteId, themeId, slug);
  return { published: toBlocks(doc), draft: toBlocks(draft) };
}

export async function saveStoredTemplate(
  siteId: string,
  themeId: string,
  slug: string,
  blocks: unknown,
  draft = false,
): Promise<BlockNode[]> {
  const sanitized = sanitizeBlockDocument({ version: 1, blocks });
  const doc = { version: 1 as const, blocks: sanitized.blocks };
  if (draft) await saveThemeTemplateDraft(siteId, themeId, slug, doc);
  else await saveThemeTemplatePublished(siteId, themeId, slug, doc);
  return sanitized.blocks as BlockNode[];
}

export async function publishStoredTemplate(
  siteId: string,
  themeId: string,
  slug: string,
  blocks: unknown,
): Promise<BlockNode[]> {
  const sanitized = sanitizeBlockDocument({ version: 1, blocks });
  await publishThemeTemplateDoc(siteId, themeId, slug, {
    version: 1,
    blocks: sanitized.blocks,
  });
  return sanitized.blocks as BlockNode[];
}

export async function clearStoredTemplateDraft(
  siteId: string,
  themeId: string,
  slug: string,
): Promise<void> {
  await clearThemeTemplateDraftDoc(siteId, themeId, slug);
}

/** Drop the override — the template reverts to the theme's own file. */
export async function resetStoredTemplate(
  siteId: string,
  themeId: string,
  slug: string,
): Promise<void> {
  await deleteThemeTemplateRow(siteId, themeId, slug);
}

export interface TemplateSlotStatus {
  slug: string;
  /** The theme ships `templates/<slug>.json`. */
  inTheme: boolean;
  /** The site has a published override row. */
  customised: boolean;
  /** The site has an unpublished draft for this slug. */
  hasDraft: boolean;
}

/**
 * Every template slug relevant to this theme/site: the theme's own files plus
 * any slug the site has overridden even if the theme has no such file.
 */
export async function listTemplateSlots(
  siteId: string,
  themeId: string,
  installedPath: string | null,
): Promise<TemplateSlotStatus[]> {
  const inThemeSlugs = new Set(listThemeTemplateSlugs(themeId, installedPath));
  const overridden = new Set(await listOverriddenTemplateSlugs(siteId, themeId));
  const slugs = [...new Set([...inThemeSlugs, ...overridden])].sort();

  return Promise.all(
    slugs.map(async (slug) => ({
      slug,
      inTheme: inThemeSlugs.has(slug),
      customised: overridden.has(slug),
      hasDraft: overridden.has(slug) ? await themeTemplateHasDraft(siteId, themeId, slug) : false,
    })),
  );
}

export interface ResolvedTemplate {
  slug: string;
  blocks: BlockNode[];
  source: "override" | "theme";
}

/**
 * The template to render for a request: per-slug, a site override (its draft in
 * preview) beats the theme's file; the first candidate slug with either wins.
 * `null` means no template anywhere — the caller falls back to the built-in view.
 */
export async function resolveEffectiveTemplate(
  siteId: string | null,
  themeId: string,
  installedPath: string | null,
  query: TemplateQuery,
  preview: boolean,
): Promise<ResolvedTemplate | null> {
  for (const slug of templateCandidates(query)) {
    if (siteId) {
      if (preview) {
        const draft = await getStoredTemplate(siteId, themeId, slug, true);
        if (draft?.length) return { slug, blocks: draft, source: "override" };
      }
      const published = await getStoredTemplate(siteId, themeId, slug, false);
      if (published?.length) return { slug, blocks: published, source: "override" };
    }
    const themeBlocks = loadThemeTemplate(themeId, slug, installedPath);
    if (themeBlocks?.length) return { slug, blocks: themeBlocks, source: "theme" };
  }
  return null;
}
