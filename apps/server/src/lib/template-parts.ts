// SPDX-License-Identifier: MIT

import { sanitizeBlockDocument } from "@justflows/blocks";
import { getSiteSetting, setSiteSetting } from "./site-settings.js";
import type { BlockNode } from "./types.js";

/**
 * Template parts: chrome that is the same on every page and is edited as
 * blocks rather than as a template file.
 *
 * The page header is already per-page and stays that way. The footer is site
 * wide, so it lives here — one document, rendered into the layout below the
 * page content.
 */
export const TEMPLATE_PARTS = ["footer"] as const;
export type TemplatePart = (typeof TEMPLATE_PARTS)[number];

export function isTemplatePart(value: unknown): value is TemplatePart {
  return typeof value === "string" && (TEMPLATE_PARTS as readonly string[]).includes(value);
}

function key(part: TemplatePart, draft: boolean): string {
  return draft ? `template_part_draft.${part}` : `template_part.${part}`;
}

export async function getTemplatePart(
  siteId: string,
  part: TemplatePart,
  draft = false,
): Promise<BlockNode[]> {
  const stored = await getSiteSetting<{ blocks?: unknown }>(siteId, key(part, draft));
  if (!stored) return [];
  return sanitizeBlockDocument({ version: 1, blocks: stored.blocks }).blocks as BlockNode[];
}

export async function saveTemplatePart(
  siteId: string,
  part: TemplatePart,
  blocks: unknown,
  draft = false,
): Promise<BlockNode[]> {
  const sanitized = sanitizeBlockDocument({ version: 1, blocks });
  await setSiteSetting(siteId, key(part, draft), { version: 1, blocks: sanitized.blocks });
  return sanitized.blocks as BlockNode[];
}

/**
 * The published part, falling back to the draft only in preview.
 *
 * An empty part is not "no footer" — it means the site never customised one,
 * and the layout keeps its built-in menu and credit line.
 */
export async function getEffectiveTemplatePart(
  siteId: string,
  part: TemplatePart,
  preview: boolean,
): Promise<BlockNode[]> {
  if (preview) {
    const draft = await getTemplatePart(siteId, part, true);
    if (draft.length > 0) return draft;
  }
  return getTemplatePart(siteId, part, false);
}
