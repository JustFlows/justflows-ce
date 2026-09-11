// SPDX-License-Identifier: MIT

import { esc, safeMediaSrc } from "./safe-url.js";

/**
 * Responsive `<img>` / `<picture>` rendering shared by `core.image` and theme
 * helpers (#103).
 *
 * The server resolves an uploaded image's stored derivatives and passes them in
 * as `sources` (one entry per modern format) plus a plain-format `srcset`
 * fallback. Everything here is treated as untrusted: URLs go through
 * `safeMediaSrc`, descriptors must be `<n>w` / `<n>x`, dimensions are clamped,
 * and the `sizes` string is character-filtered. With no `sources` the output is
 * a single `<img>`, so a block that was never resolved still renders.
 *
 * Defaults follow the issue: `loading="lazy"` and `decoding="async"`, with an
 * opt-out (`loading: "eager"` adds `fetchpriority="high"` and drops lazy) for
 * above-the-fold images. Intrinsic `width`/`height` are emitted whenever known
 * so the browser can reserve space and avoid layout shift.
 */

export interface ResponsiveSource {
  /** e.g. `image/avif`, `image/webp`. */
  type: string;
  srcset: string;
}

export interface ResponsiveImageInput {
  src: string;
  alt?: string;
  /** Intrinsic pixel dimensions of the fallback image (prevents layout shift). */
  width?: number;
  height?: number;
  /** `sizes` attribute; a sensible default is used when omitted and sources exist. */
  sizes?: string;
  /** Modern-format candidates, most-preferred first (AVIF before WebP). */
  sources?: ResponsiveSource[];
  /** Fallback-format candidate set for the `<img>` itself. */
  fallbackSrcset?: string;
  loading?: "lazy" | "eager";
  /** CSS object-fit for the rendered box; focal point drives object-position. */
  objectFit?: "contain" | "cover" | "fill";
  /** Display box dimensions (CSS px). Distinct from intrinsic width/height. */
  displayWidth?: number;
  displayHeight?: number;
  /** Focal point 0..1; positions the subject when the box crops the image. */
  focalX?: number;
  focalY?: number;
  /** Extra classes / inline style merged onto the `<img>`. */
  className?: string;
  extraStyle?: string;
}

const TYPE_RE = /^image\/[a-z0-9.+-]{2,40}$/i;
const DESCRIPTOR_RE = /^(?:[1-9]\d{0,4}w|[0-9]+(?:\.\d+)?x)$/;

function clampInt(value: unknown, max: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, max);
}

function clamp01(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

/** Filter a `sizes` attribute: media queries and lengths only, no delimiters that could break out. */
export function sanitizeSizes(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s.length > 300) return "";
  if (/[<>"'`;{}\\]/.test(s)) return "";
  return s;
}

/** Re-serialize a `srcset`, dropping any candidate with an unsafe URL or a malformed descriptor. */
export function sanitizeSrcset(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const tokens = part.trim().split(/\s+/);
    if (tokens.length === 0 || !tokens[0]) continue;
    const url = safeMediaSrc(tokens[0]);
    if (!url) continue;
    const descriptor = tokens[1];
    if (descriptor === undefined) {
      out.push(url);
    } else if (DESCRIPTOR_RE.test(descriptor)) {
      out.push(`${url} ${descriptor}`);
    }
  }
  return out.join(", ");
}

function sanitizeSources(sources: ResponsiveSource[] | undefined): ResponsiveSource[] {
  if (!Array.isArray(sources)) return [];
  const out: ResponsiveSource[] = [];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const type = typeof source.type === "string" && TYPE_RE.test(source.type) ? source.type : "";
    const srcset = sanitizeSrcset(source.srcset);
    if (type && srcset) out.push({ type, srcset });
  }
  return out;
}

function styleFor(input: ResponsiveImageInput): string {
  const parts = ["display:block", "max-width:100%"];
  const dw = clampInt(input.displayWidth, 10000);
  const dh = clampInt(input.displayHeight, 10000);
  if (dw > 0) parts.push(`width:${dw}px`);
  if (dh > 0) parts.push(`height:${dh}px`);
  const fit = input.objectFit;
  if (dh > 0 && (fit === "cover" || fit === "fill")) {
    parts.push(`object-fit:${fit}`);
    const fx = clamp01(input.focalX);
    const fy = clamp01(input.focalY);
    if (fx !== null || fy !== null) {
      parts.push(
        `object-position:${((fx ?? 0.5) * 100).toFixed(2)}% ${((fy ?? 0.5) * 100).toFixed(2)}%`,
      );
    }
  }
  if (input.extraStyle) parts.push(input.extraStyle);
  return parts.join(";");
}

/** Render an image as `<picture>` when modern-format sources are present, else a bare `<img>`. */
export function renderResponsiveImage(input: ResponsiveImageInput): string {
  const src = safeMediaSrc(input.src);
  if (!src) return "";

  const eager = input.loading === "eager";
  const width = clampInt(input.width, 30000);
  const height = clampInt(input.height, 30000);
  const sizes = sanitizeSizes(input.sizes) || (input.sources?.length ? "100vw" : "");
  const sources = sanitizeSources(input.sources);
  const fallbackSrcset = sanitizeSrcset(input.fallbackSrcset);

  const imgAttrs = [
    `src="${src}"`,
    `alt="${esc(input.alt ?? "")}"`,
    eager ? 'loading="eager"' : 'loading="lazy"',
    'decoding="async"',
    eager ? 'fetchpriority="high"' : "",
    width > 0 ? `width="${width}"` : "",
    height > 0 ? `height="${height}"` : "",
    fallbackSrcset ? `srcset="${fallbackSrcset}"` : "",
    fallbackSrcset && sizes ? `sizes="${esc(sizes)}"` : "",
    input.className ? `class="${esc(input.className)}"` : "",
    `style="${styleFor(input)}"`,
  ]
    .filter(Boolean)
    .join(" ");

  const img = `<img ${imgAttrs}>`;
  if (sources.length === 0) return img;

  const sourceTags = sources
    .map(
      (s) =>
        `<source type="${esc(s.type)}" srcset="${s.srcset}"${sizes ? ` sizes="${esc(sizes)}"` : ""}>`,
    )
    .join("");
  return `<picture>${sourceTags}${img}</picture>`;
}
