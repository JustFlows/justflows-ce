// SPDX-License-Identifier: MIT

import {
  renderResponsiveImage,
  safeMediaSrc,
  type ResponsiveImageInput,
  type ResponsiveSource,
} from "@justflows/blocks";
import { getDb } from "./db.js";
import { getSiteId } from "./themes-db.js";
import type { MediaDerivatives, MediaVariantRecord } from "./media-responsive.js";

/**
 * Shared responsive-image plumbing (#103).
 *
 * One place every public image-rendering surface goes through — `core.image`,
 * the gallery block, blog-post-list thumbnails, the Featured Image template
 * block — so a page never ships the full-resolution original when sized
 * variants exist. Given a media URL it loads the stored `derivatives` and turns
 * them into the `<picture>` / `srcset` inputs `@justflows/blocks` renders and
 * re-sanitizes.
 *
 * Emission is configurable: `JF_IMAGE_RESPONSIVE_MARKUP=0` (Admin → Tools →
 * Responsive images) serves plain `<img src>` originals everywhere, without
 * touching the generated files. Generation itself is gated separately by
 * `JF_IMAGE_DERIVATIVES`.
 */

const MODERN_FORMAT_ORDER = ["avif", "webp"] as const;

export interface ResponsiveProp {
  src: string;
  width: number;
  height: number;
  sources: ResponsiveSource[];
  fallbackSrcset: string;
  focalX: number | null;
  focalY: number | null;
}

interface MediaRowLite {
  url: string;
  width: number | string | null;
  height: number | string | null;
  derivatives: unknown;
  focal_x: number | string | null;
  focal_y: number | string | null;
}

/** Whether the public site emits `<picture>`/`srcset`. Default on. */
export function responsiveMarkupEnabled(): boolean {
  const raw = process.env.JF_IMAGE_RESPONSIVE_MARKUP;
  if (raw === undefined || raw === "") return true;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

export function parseDerivatives(raw: unknown): MediaDerivatives | null {
  if (!raw) return null;
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (raw === "" || raw === "{}") return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (value && typeof value === "object" && Array.isArray((value as MediaDerivatives).variants)) {
    return value as MediaDerivatives;
  }
  return null;
}

function srcsetFor(variants: MediaVariantRecord[]): string {
  return [...variants]
    .sort((a, b) => a.w - b.w)
    .map((v) => `${v.url} ${v.w}w`)
    .join(", ");
}

export function buildResponsiveProp(row: MediaRowLite): ResponsiveProp | null {
  const derivatives = parseDerivatives(row.derivatives);
  if (!derivatives || derivatives.variants.length === 0) return null;

  const byFormat = new Map<string, MediaVariantRecord[]>();
  for (const v of derivatives.variants) {
    const list = byFormat.get(v.format) ?? [];
    list.push(v);
    byFormat.set(v.format, list);
  }

  const modernFormats = MODERN_FORMAT_ORDER.filter((f) => byFormat.has(f));
  const fallbackFormat = [...byFormat.keys()].find((f) => f !== "avif" && f !== "webp");
  const fallbackVariants = fallbackFormat ? (byFormat.get(fallbackFormat) ?? []) : [];

  const sources: ResponsiveSource[] = modernFormats.map((f) => ({
    type: `image/${f}`,
    srcset: srcsetFor(byFormat.get(f) ?? []),
  }));

  const largestFallback = [...fallbackVariants].sort((a, b) => b.w - a.w)[0];
  const src = largestFallback?.url ?? row.url;

  const intrinsicW = Number(row.width ?? derivatives.base?.w ?? 0) || 0;
  const intrinsicH = Number(row.height ?? derivatives.base?.h ?? 0) || 0;

  if (!sources.length && !fallbackVariants.length) return null;

  return {
    src,
    width: intrinsicW,
    height: intrinsicH,
    sources,
    fallbackSrcset: srcsetFor(fallbackVariants),
    focalX: row.focal_x == null ? null : Number(row.focal_x),
    focalY: row.focal_y == null ? null : Number(row.focal_y),
  };
}

/** Only uploaded files carry derivatives; skip theme assets, remote URLs, and data URIs. */
export function isUploadUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/uploads/");
}

/**
 * Batch-load `ResponsiveProp`s for a set of upload URLs. Returns an empty map
 * when responsive markup is disabled, no site is resolvable, or the query
 * fails — every caller degrades to a plain `<img>`.
 */
export async function loadResponsiveProps(
  urls: Iterable<string>,
  siteId?: string | null,
): Promise<Map<string, ResponsiveProp>> {
  const out = new Map<string, ResponsiveProp>();
  if (!responsiveMarkupEnabled()) return out;

  const list = [...new Set([...urls].filter(isUploadUrl))];
  if (list.length === 0) return out;

  const resolvedSite = siteId ?? (await getSiteId());
  if (!resolvedSite) return out;

  const placeholders = list.map(() => "?").join(", ");
  let rows: MediaRowLite[];
  try {
    rows = await (
      await getDb()
    ).query<MediaRowLite>(
      `SELECT url, width, height, derivatives, focal_x, focal_y FROM media
       WHERE site_id = ? AND trashed_at IS NULL AND url IN (${placeholders})`,
      [resolvedSite, ...list],
    );
  } catch {
    return out;
  }

  for (const row of rows) {
    const prop = buildResponsiveProp(row);
    if (prop) out.set(row.url, prop);
  }
  return out;
}

/** Merge a resolved `ResponsiveProp` into `renderResponsiveImage` inputs. */
export function applyResponsiveProp(
  base: ResponsiveImageInput,
  prop: ResponsiveProp | undefined,
): ResponsiveImageInput {
  if (!prop) return base;
  const next: ResponsiveImageInput = { ...base, src: prop.src || base.src };
  if (prop.width) next.width = prop.width;
  if (prop.height) next.height = prop.height;
  if (prop.sources.length) next.sources = prop.sources;
  if (prop.fallbackSrcset) next.fallbackSrcset = prop.fallbackSrcset;
  if (prop.focalX !== null) next.focalX = prop.focalX;
  if (prop.focalY !== null) next.focalY = prop.focalY;
  return next;
}

export interface RenderMediaImageOptions {
  url: string;
  siteId?: string | null;
  alt?: string;
  sizes?: string;
  loading?: "lazy" | "eager";
  className?: string;
  objectFit?: "contain" | "cover" | "fill";
  displayWidth?: number;
  displayHeight?: number;
  /** Pre-resolved prop (from `loadResponsiveProps`) — skips the per-call DB lookup. */
  resolved?: ResponsiveProp;
}

/**
 * Render one media URL as responsive `<picture>` markup, falling back to a
 * plain `<img>` when the URL has no derivatives or responsive markup is off.
 * `alt` is required for anything user-visible; pass `""` for decorative images.
 */
export async function renderMediaImage(opts: RenderMediaImageOptions): Promise<string> {
  const src = safeMediaSrc(opts.url);
  if (!src) return "";

  let prop = opts.resolved;
  if (!prop && responsiveMarkupEnabled() && isUploadUrl(opts.url)) {
    const map = await loadResponsiveProps([opts.url], opts.siteId);
    prop = map.get(opts.url);
  }

  const base: ResponsiveImageInput = { src, alt: opts.alt ?? "" };
  if (opts.sizes) base.sizes = opts.sizes;
  if (opts.loading) base.loading = opts.loading;
  if (opts.className) base.className = opts.className;
  if (opts.objectFit) base.objectFit = opts.objectFit;
  if (opts.displayWidth) base.displayWidth = opts.displayWidth;
  if (opts.displayHeight) base.displayHeight = opts.displayHeight;

  return renderResponsiveImage(applyResponsiveProp(base, prop));
}
