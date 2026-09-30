// SPDX-License-Identifier: MIT

import { z } from "zod";

/**
 * Placeholder images — what the site shows when an image slot is empty.
 *
 * Justflows ships a neutral default for every core kind (`/placeholders/*`).
 * Resolution for one kind, first match wins:
 *
 * 1. the site owner's own image (Admin → Settings → Placeholders);
 * 2. the `media.placeholder` filter, seeded with 3 or 4;
 * 3. the image a plugin registered for its own kind (`ctx.media.registerPlaceholder`);
 * 4. the shipped default for the kind, or `generic` for an unknown kind.
 *
 * A site owner can switch placeholders off; every lookup then returns `null`
 * and the slot stays empty, as it did before placeholders existed.
 */

/** Kinds the host ships an image for. */
export const CORE_PLACEHOLDER_KINDS = ["generic", "featured", "thumbnail", "avatar", "og"] as const;
export type CorePlaceholderKind = (typeof CORE_PLACEHOLDER_KINDS)[number];

/** A core kind, or a plugin kind namespaced under its plugin id (`justflows.shop.product`). */
export type PlaceholderKind = CorePlaceholderKind | (string & {});

export const PLACEHOLDER_KIND_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/** Site-root path (`/ext/…`, `/uploads/…`) or an `https:` URL. */
function isPlaceholderSrc(value: string): boolean {
  if (value.startsWith("/")) return !value.startsWith("//") && !value.includes("\\");
  return /^https:\/\/[^\s"'<>]+$/i.test(value);
}

export const PlaceholderDefinitionSchema = z.object({
  src: z
    .string()
    .min(1)
    .max(2048)
    .refine(isPlaceholderSrc, "Placeholder src must be a site-root path or an https: URL"),
  /** Intrinsic size, so the slot reserves space and never shifts layout. */
  width: z.number().int().min(1).max(10_000),
  height: z.number().int().min(1).max(10_000),
  /** Name shown in Admin → Settings → Placeholders. */
  label: z.string().min(1).max(100).optional(),
});

export type PlaceholderDefinition = z.infer<typeof PlaceholderDefinitionSchema>;

/** A resolved placeholder, ready to render. */
export interface PlaceholderImage {
  kind: string;
  src: string;
  width: number;
  height: number;
  /** Where the image came from. */
  source: "site" | "plugin" | "core" | "filter";
}

export interface PlaceholderFilterContext {
  siteId: string;
  kind: string;
}

export interface PlaceholderHtmlOptions {
  /** Defaults to `""`: a placeholder is decorative. */
  alt?: string;
  /** Added after `jf-placeholder jf-placeholder--<kind>`. */
  className?: string;
  loading?: "lazy" | "eager";
}

export interface PluginMediaApi {
  /**
   * The placeholder for `kind` on this site, or `null` when the site owner
   * switched placeholders off. Synchronous, so block `render()` can call it.
   */
  placeholder(kind: PlaceholderKind): PlaceholderImage | null;

  /** `placeholder(kind)` as an escaped `<img>`, or `""` when switched off. */
  placeholderHtml(kind: PlaceholderKind, options?: PlaceholderHtmlOptions): string;

  /**
   * Ship a default image for a kind this plugin owns. `kind` must start with
   * the plugin id (`justflows.shop.product`). Site owners can still replace
   * it. Removed on deactivate.
   */
  registerPlaceholder(kind: string, definition: PlaceholderDefinition): () => void;
}
