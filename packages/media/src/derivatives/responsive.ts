// SPDX-License-Identifier: MIT

import sharp, { type Sharp } from "sharp";

/**
 * Responsive-image derivative generation for the media library (#103).
 *
 * Given an uploaded raster image this produces a set of width-scaled variants
 * in the original-appropriate fallback format (JPEG, or PNG when the source has
 * an alpha channel) plus one or more modern formats (WebP, and AVIF when
 * enabled). It also produces a single focal-point square thumbnail for the
 * library and small UI. Callers persist the bytes and hand the metadata to the
 * theme layer, which emits `<picture>`/`srcset` with intrinsic `width`/`height`.
 *
 * This module stays free of storage, database, and HTTP concerns — it only
 * turns buffers into buffers. `sharp` strips EXIF/GPS by default (we never call
 * `.withMetadata()` unless asked), and `.rotate()` with no argument bakes in the
 * EXIF orientation before the tag is dropped so a stripped variant is never
 * left sideways.
 */

export type OutputFormat = "webp" | "avif" | "jpeg" | "png";

const MIME_BY_FORMAT: Record<OutputFormat, string> = {
  webp: "image/webp",
  avif: "image/avif",
  jpeg: "image/jpeg",
  png: "image/png",
};

const EXT_BY_FORMAT: Record<OutputFormat, string> = {
  webp: "webp",
  avif: "avif",
  jpeg: "jpg",
  png: "png",
};

export function formatMimeType(format: OutputFormat): string {
  return MIME_BY_FORMAT[format];
}

export function formatExtension(format: OutputFormat): string {
  return EXT_BY_FORMAT[format];
}

export interface ResponsiveImageConfig {
  /** Target widths in CSS pixels, ascending. Widths at or above the source width are skipped (no upscaling). */
  widths: number[];
  /** Modern formats to emit in addition to the fallback, e.g. `["webp"]` or `["webp", "avif"]`. */
  formats: OutputFormat[];
  /** Encoder quality per format (1–100). */
  quality: Record<OutputFormat, number>;
  /** Hard ceiling on the largest generated width; the source is downscaled to this at most. */
  maxWidth: number;
  /** Strip EXIF/GPS and other metadata from derived variants (default true). */
  stripMetadata: boolean;
  /** Square focal-point thumbnail, or `null` to skip it. */
  thumbnail: { width: number; height: number } | null;
}

export const DEFAULT_RESPONSIVE_CONFIG: ResponsiveImageConfig = {
  widths: [320, 640, 960, 1280, 1920],
  formats: ["webp"],
  quality: { webp: 82, avif: 50, jpeg: 82, png: 100 },
  maxWidth: 2560,
  stripMetadata: true,
  thumbnail: { width: 400, height: 400 },
};

/** A normalized focal point in the 0–1 range; `{ x: 0.5, y: 0.5 }` is the centre. */
export interface FocalPoint {
  x: number;
  y: number;
}

export const CENTER_FOCAL: FocalPoint = { x: 0.5, y: 0.5 };

export function clampFocal(focal: Partial<FocalPoint> | null | undefined): FocalPoint {
  const clamp01 = (n: unknown): number => {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0.5;
    return Math.min(1, Math.max(0, v));
  };
  return { x: clamp01(focal?.x), y: clamp01(focal?.y) };
}

export interface GeneratedVariant {
  /** Stable name within the set: the pixel width for scaled variants, `"thumb"` for the thumbnail. */
  name: string;
  kind: "scaled" | "thumb";
  format: OutputFormat;
  mimeType: string;
  width: number;
  height: number;
  data: Buffer;
  sizeBytes: number;
}

export interface SourceInfo {
  width: number;
  height: number;
  format: string;
  hasAlpha: boolean;
  sizeBytes: number;
}

export interface ResponsiveSet {
  source: SourceInfo;
  variants: GeneratedVariant[];
}

function mergeConfig(partial?: Partial<ResponsiveImageConfig>): ResponsiveImageConfig {
  const base = DEFAULT_RESPONSIVE_CONFIG;
  return {
    widths: partial?.widths?.length ? [...partial.widths] : [...base.widths],
    formats: partial?.formats?.length ? [...partial.formats] : [...base.formats],
    quality: { ...base.quality, ...(partial?.quality ?? {}) },
    maxWidth: partial?.maxWidth && partial.maxWidth > 0 ? partial.maxWidth : base.maxWidth,
    stripMetadata: partial?.stripMetadata ?? base.stripMetadata,
    thumbnail: partial?.thumbnail === null ? null : (partial?.thumbnail ?? base.thumbnail),
  };
}

function applyFormat(
  pipeline: Sharp,
  format: OutputFormat,
  quality: Record<OutputFormat, number>,
): Sharp {
  switch (format) {
    case "webp":
      return pipeline.webp({ quality: quality.webp });
    case "avif":
      return pipeline.avif({ quality: quality.avif });
    case "png":
      return pipeline.png({ compressionLevel: 9, palette: true });
    case "jpeg":
    default:
      return pipeline.jpeg({ quality: quality.jpeg, mozjpeg: true });
  }
}

/** The widths actually worth generating for a source of `sourceWidth` px. */
export function effectiveWidths(
  sourceWidth: number,
  config: Pick<ResponsiveImageConfig, "widths" | "maxWidth">,
): number[] {
  const cap = Math.min(sourceWidth, config.maxWidth);
  const set = new Set<number>();
  for (const w of config.widths) {
    if (w > 0 && w < cap) set.add(Math.round(w));
  }
  // Always include the capped top width so the largest layout still has a
  // matched candidate rather than falling back to the full-resolution original.
  if (cap > 0) set.add(Math.round(cap));
  return [...set].sort((a, b) => a - b);
}

async function baseline(input: Buffer, stripMetadata: boolean): Promise<Sharp> {
  // `.rotate()` bakes EXIF orientation in before any metadata is dropped.
  const pipeline = sharp(input, { failOn: "none" }).rotate();
  return stripMetadata ? pipeline : pipeline.withMetadata();
}

function focalCropGeometry(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  focal: FocalPoint,
): { resizeWidth: number; resizeHeight: number; left: number; top: number } {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const resizeWidth = Math.max(targetWidth, Math.round(sourceWidth * scale));
  const resizeHeight = Math.max(targetHeight, Math.round(sourceHeight * scale));
  const left = Math.min(
    Math.max(Math.round(focal.x * resizeWidth - targetWidth / 2), 0),
    resizeWidth - targetWidth,
  );
  const top = Math.min(
    Math.max(Math.round(focal.y * resizeHeight - targetHeight / 2), 0),
    resizeHeight - targetHeight,
  );
  return { resizeWidth, resizeHeight, left, top };
}

/**
 * Build the full responsive variant set for one image buffer.
 *
 * Throws when the buffer is not a decodable raster image or has no dimensions —
 * callers treat that as "store the original only".
 */
export async function generateResponsiveSet(
  input: Buffer,
  opts: { config?: Partial<ResponsiveImageConfig>; focal?: Partial<FocalPoint> | null } = {},
): Promise<ResponsiveSet> {
  const config = mergeConfig(opts.config);
  const focal = clampFocal(opts.focal);

  const meta = await sharp(input, { failOn: "none" }).metadata();
  const srcWidth = meta.width ?? 0;
  const srcHeight = meta.height ?? 0;
  if (srcWidth <= 0 || srcHeight <= 0) {
    throw new Error("Image has no readable dimensions");
  }

  const source: SourceInfo = {
    width: srcWidth,
    height: srcHeight,
    format: meta.format ?? "unknown",
    hasAlpha: meta.hasAlpha ?? false,
    sizeBytes: input.byteLength,
  };

  const fallbackFormat: OutputFormat = source.hasAlpha ? "png" : "jpeg";
  // Fallback first so `<img srcset>` degrades cleanly; modern formats layer on top.
  const formatsToEmit: OutputFormat[] = [
    fallbackFormat,
    ...config.formats.filter((f) => f !== fallbackFormat),
  ];

  const widths = effectiveWidths(srcWidth, config);
  const variants: GeneratedVariant[] = [];

  for (const width of widths) {
    for (const format of formatsToEmit) {
      const pipeline = (await baseline(input, config.stripMetadata)).resize({
        width,
        withoutEnlargement: true,
      });
      const { data, info } = await applyFormat(pipeline, format, config.quality).toBuffer({
        resolveWithObject: true,
      });
      variants.push({
        name: String(width),
        kind: "scaled",
        format,
        mimeType: MIME_BY_FORMAT[format],
        width: info.width,
        height: info.height,
        data,
        sizeBytes: data.byteLength,
      });
    }
  }

  if (config.thumbnail) {
    const { width: tw, height: th } = config.thumbnail;
    const thumbFormat: OutputFormat = config.formats.includes("webp") ? "webp" : fallbackFormat;
    const geo = focalCropGeometry(srcWidth, srcHeight, tw, th, focal);
    const pipeline = (await baseline(input, config.stripMetadata))
      .resize(geo.resizeWidth, geo.resizeHeight, { fit: "fill" })
      .extract({ left: geo.left, top: geo.top, width: tw, height: th });
    const { data, info } = await applyFormat(pipeline, thumbFormat, config.quality).toBuffer({
      resolveWithObject: true,
    });
    variants.push({
      name: "thumb",
      kind: "thumb",
      format: thumbFormat,
      mimeType: MIME_BY_FORMAT[thumbFormat],
      width: info.width,
      height: info.height,
      data,
      sizeBytes: data.byteLength,
    });
  }

  return { source, variants };
}

/** MIME types the responsive pipeline can decode and re-encode. Vector, icon, and document types are excluded. */
export const RASTER_IMAGE_MIME_TYPES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
]);

export function isRasterImageMimeType(mimeType: string): boolean {
  return RASTER_IMAGE_MIME_TYPES.has(mimeType.toLowerCase());
}
