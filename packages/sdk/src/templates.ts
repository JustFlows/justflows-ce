// SPDX-License-Identifier: MIT

/**
 * The theme template-hierarchy contract, shared by the host renderer, the admin
 * builder, and theme tooling. A Justflows theme ships one JSON block document
 * per slot under `templates/` and shared chrome under `parts/` — the same
 * `{ "blocks": [...] }` shape the visual builder reads and writes, not PHP.
 *
 * See https://developer.wordpress.org/themes/templates/template-hierarchy/ for
 * the model this mirrors.
 */

import { z } from "zod";

/** Every template slot a theme may define, coarsest fallbacks last. */
export const TEMPLATE_SLOTS = [
  "front-page",
  "home",
  "single",
  "page",
  "singular",
  "archive",
  "search",
  "404",
  "index",
] as const;

export type TemplateSlot = (typeof TEMPLATE_SLOTS)[number];

/** Site-editable template parts (chrome shared across templates). */
export const TEMPLATE_PART_SLOTS = ["header", "footer"] as const;
export type TemplatePartSlot = (typeof TEMPLATE_PART_SLOTS)[number];

/** A template / part slug: `single`, `single-product`, `page-about`, … */
export const TEMPLATE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

export function isTemplateSlug(value: unknown): value is string {
  return typeof value === "string" && TEMPLATE_SLUG_RE.test(value);
}

/**
 * The `templates` / `parts` maps in `justflows-theme.json` — slug → relative
 * path. Purely declarative: the host also discovers `templates/*.json` by
 * directory scan, so the map is for tooling and documentation.
 */
export const ThemeTemplatesManifestSchema = z
  .object({
    templates: z.record(z.string(), z.string()).optional(),
    parts: z.record(z.string(), z.string()).optional(),
  })
  .partial();

export type ThemeTemplatesManifest = z.infer<typeof ThemeTemplatesManifestSchema>;

/** A stored template body: a block document. */
export const TemplateDocSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  blocks: z.array(z.record(z.string(), z.unknown())),
});

export type TemplateDoc = z.infer<typeof TemplateDocSchema>;
