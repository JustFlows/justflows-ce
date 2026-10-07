// SPDX-License-Identifier: MIT

import {
  generateResponsiveSet,
  isRasterImageMimeType,
  formatExtension,
  formatMimeType,
  type OutputFormat,
  type ResponsiveImageConfig,
} from "@justflows/media";
import { legacyTrashedVariantPrefix, variantPrefix } from "./upload-paths.js";
import { getUploadStore } from "./upload-store.js";

/**
 * Server-side glue for responsive image derivatives (#103).
 *
 * `@justflows/media` turns an image buffer into a set of width-scaled WebP/AVIF
 * variants plus a fallback format and a focal-point thumbnail. This module reads
 * the site's configuration from the environment, writes the variant bytes next
 * to the original under `uploads/<siteId>/<mediaId>/`, and produces the JSON
 * that lands in `media.derivatives` for the public renderer to attach to
 * `<picture>`/`srcset`.
 *
 * Configuration is read live on every call so the Tools → Responsive images
 * panel takes effect for the next upload and the next regeneration run without
 * a restart. Vector, icon, and document uploads are never touched.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MediaVariantRecord {
  w: number;
  h: number;
  format: OutputFormat;
  url: string;
  bytes: number;
}

export interface MediaDerivatives {
  base: { w: number; h: number; format: string };
  variants: MediaVariantRecord[];
  thumb?: { url: string; w: number; h: number };
  widths: number[];
  formats: OutputFormat[];
  generatedAt: string;
}

export interface ResolvedImageConfig {
  /** Master switch — when false, uploads store the original only. */
  enabled: boolean;
  config: ResponsiveImageConfig;
  /** Filename globs (e.g. `logo*`, `*.png`) whose uploads keep their original only. */
  keepOriginalGlobs: string[];
}

function num(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function bool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

function parseWidths(raw: string | undefined, fallback: number[]): number[] {
  if (!raw) return fallback;
  const list = raw
    .split(",")
    .map((s) => Math.floor(Number(s.trim())))
    .filter((n) => Number.isFinite(n) && n >= 16 && n <= 8192);
  return list.length ? [...new Set(list)].sort((a, b) => a - b) : fallback;
}

function parseFormats(raw: string | undefined): OutputFormat[] {
  const allowed: OutputFormat[] = ["webp", "avif"];
  if (!raw) return ["webp"];
  const list = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is OutputFormat => (allowed as string[]).includes(s));
  return list.length ? [...new Set(list)] : ["webp"];
}

/** Read the live responsive-image configuration from the environment. */
export function resolveImageConfig(): ResolvedImageConfig {
  const env = process.env;
  const thumbRaw = (env.JF_IMAGE_THUMB ?? "400x400").trim().toLowerCase();
  let thumbnail: ResponsiveImageConfig["thumbnail"] = { width: 400, height: 400 };
  if (thumbRaw === "off" || thumbRaw === "0") {
    thumbnail = null;
  } else {
    const m = thumbRaw.match(/^(\d{2,4})x(\d{2,4})$/);
    if (m) thumbnail = { width: Number(m[1]), height: Number(m[2]) };
  }

  return {
    enabled: bool(env.JF_IMAGE_DERIVATIVES, true),
    config: {
      widths: parseWidths(env.JF_IMAGE_WIDTHS, [320, 640, 960, 1280, 1920]),
      formats: parseFormats(env.JF_IMAGE_FORMATS),
      quality: {
        webp: num(env.JF_IMAGE_QUALITY_WEBP, 82),
        avif: num(env.JF_IMAGE_QUALITY_AVIF, 50),
        jpeg: num(env.JF_IMAGE_QUALITY_JPEG, 82),
        png: 100,
      },
      maxWidth: num(env.JF_IMAGE_MAX_WIDTH, 2560),
      stripMetadata: bool(env.JF_IMAGE_STRIP_METADATA, true),
      thumbnail,
    },
    keepOriginalGlobs: (env.JF_IMAGE_KEEP_ORIGINAL ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  };
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

/** Whether an upload filename is on the "keep original format only" allowlist. */
export function keepOriginalOnly(filename: string, globs: string[]): boolean {
  const name = filename.toLowerCase();
  return globs.some((g) => globToRegExp(g).test(name));
}

function variantDir(siteId: string, mediaId: string, trashed = false): string | null {
  if (!UUID_RE.test(siteId) || !UUID_RE.test(mediaId)) return null;
  return variantPrefix(siteId, mediaId, trashed);
}

/** Trashed variant folder in the pre-per-site shared trash. */
function legacyTrashedVariantDir(siteId: string, mediaId: string): string | null {
  if (!UUID_RE.test(siteId) || !UUID_RE.test(mediaId)) return null;
  return legacyTrashedVariantPrefix(siteId, mediaId);
}

export interface GenerateVariantsInput {
  siteId: string;
  mediaId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  focal?: { x: number; y: number } | null;
}

/**
 * Build and persist the responsive variant set for one image. Returns the
 * `media.derivatives` payload, or `null` when derivatives are disabled, the
 * type is not a raster image, or the filename is on the keep-original list.
 * Throws only on an unexpected processing/IO failure — callers keep the upload.
 */
export async function generateAndStoreVariants(
  input: GenerateVariantsInput,
): Promise<MediaDerivatives | null> {
  const { enabled, config, keepOriginalGlobs } = resolveImageConfig();
  if (!enabled) return null;
  const { siteFeatureEnabled } = await import("../tenancy/site-features.js");
  if (!(await siteFeatureEnabled("feature.responsiveImages", input.siteId))) return null;
  if (!isRasterImageMimeType(input.mimeType)) return null;
  if (keepOriginalOnly(input.filename, keepOriginalGlobs)) return null;

  const dir = variantDir(input.siteId, input.mediaId);
  if (!dir) return null;

  const set = await generateResponsiveSet(input.buffer, {
    config,
    focal: input.focal ?? null,
  });

  const store = getUploadStore();
  const variants: MediaVariantRecord[] = [];
  let thumb: MediaDerivatives["thumb"];

  for (const v of set.variants) {
    const ext = formatExtension(v.format);
    await store.put(`${dir}${v.name}.${ext}`, v.data, formatMimeType(v.format));
    const url = `/uploads/${input.siteId}/${input.mediaId}/${v.name}.${ext}`;
    if (v.kind === "thumb") {
      thumb = { url, w: v.width, h: v.height };
    } else {
      variants.push({ w: v.width, h: v.height, format: v.format, url, bytes: v.sizeBytes });
    }
  }

  return {
    base: { w: set.source.width, h: set.source.height, format: set.source.format },
    variants,
    ...(thumb ? { thumb } : {}),
    widths: [...new Set(variants.map((v) => v.w))].sort((a, b) => a - b),
    formats: config.formats,
    generatedAt: new Date().toISOString(),
  };
}

/** Move a media item's variant folder into (or out of) `.trash`, mirroring the original file. */
export async function moveVariantDir(
  siteId: string,
  mediaId: string,
  toTrash: boolean,
): Promise<void> {
  // Restoring checks the site's own trash first, then the legacy shared one.
  const sources = toTrash
    ? [variantDir(siteId, mediaId, false)]
    : [variantDir(siteId, mediaId, true), legacyTrashedVariantDir(siteId, mediaId)];
  const to = variantDir(siteId, mediaId, toTrash);
  if (!to) return;
  const store = getUploadStore();
  for (const from of sources) {
    // move() is false when nothing was generated there.
    if (from && (await store.move(from, to))) return;
  }
}

/** Permanently remove a media item's variant folder (both live and trashed copies). */
export async function removeVariantDir(siteId: string, mediaId: string): Promise<void> {
  const dirs = [
    variantDir(siteId, mediaId, false),
    variantDir(siteId, mediaId, true),
    legacyTrashedVariantDir(siteId, mediaId),
  ];
  const store = getUploadStore();
  for (const dir of dirs) {
    if (dir) await store.deletePrefix(dir).catch(() => undefined);
  }
}
