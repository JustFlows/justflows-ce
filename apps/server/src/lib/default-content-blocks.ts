// SPDX-License-Identifier: MIT

import { sanitizeBlockDocument } from "@justflows/blocks";
import { loadThemePattern } from "./theme-files.js";
import { getActiveTheme, getSiteId, themeInstalledPath } from "./themes-db.js";

export function isEmptyBlockDocument(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return true;
  const blocks = (value as { blocks?: unknown }).blocks;
  return !Array.isArray(blocks) || blocks.length === 0;
}

/**
 * Content types that adopt a same-named theme pattern as the starting canvas for
 * a new row — `product` loads Product detail, `post` loads the theme's demo post
 * body. Kept to an explicit set so an unrelated custom type named after another
 * pattern (`about`, `landing`, …) doesn't silently inherit that pattern's blocks.
 */
const PATTERN_BACKED_TYPES = new Set(["product", "post"]);

/** Starting blocks for a new content row whose canvas is empty, from the active theme's pattern. */
export async function defaultBlocksForContentType(type: string): Promise<unknown> {
  if (!PATTERN_BACKED_TYPES.has(type)) return { version: 1, blocks: [] };
  const siteId = await getSiteId();
  const theme = siteId ? await getActiveTheme(siteId) : null;
  const themeId = theme?.theme_id ?? "justflows.default";
  const pattern = loadThemePattern(themeId, type, themeInstalledPath(theme));
  if (!pattern?.blocks.length) return { version: 1, blocks: [] };
  return sanitizeBlockDocument({ version: 1, blocks: pattern.blocks });
}
