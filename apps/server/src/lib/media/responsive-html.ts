// SPDX-License-Identifier: MIT

import { esc, renderResponsiveImage, safeMediaSrc } from "@justflows/blocks";
import {
  applyResponsiveProp,
  loadResponsiveProps,
  responsiveMarkupEnabled,
  type ResponsiveProp,
} from "./responsive-media.js";

/**
 * Make theme and plugin HTML follow the same responsive-image rules as
 * `core.image` (#103).
 *
 * Blocks, custom HTML, and plugin `render()` output often emit a plain
 * `<img src="/uploads/...">` or a CSS `background-image`. Those never consult
 * the media library, so the browser downloads the original even when WebP/AVIF
 * variants exist. This pass runs after render: every bare upload image with
 * stored derivatives becomes `<picture>` / `srcset`, and a `background-image`
 * pointing at an upload becomes `image-set()` (with the sized fallback left in
 * place for browsers that ignore `image-set`).
 *
 * Images that are already inside `<picture>`, already have a `srcset`, or have
 * no derivatives are left untouched. The `<picture>` wrapper uses
 * `display: contents` so theme rules that size the `<img>` (product cards,
 * category tiles, avatars) still apply to that element.
 */

const IMG_RE = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const BG_RE =
  /background-image\s*:\s*url\(\s*(?:&quot;|"|')?(\/uploads\/[^"'()\s&]+)(?:&quot;|"|')?\s*\)/gi;
const PROTECTED_OPEN_RE = /<!--|<script|<textarea/i;
const ATTR_RE = /([:@A-Za-z_][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

interface Replacement {
  start: number;
  end: number;
  html: string;
}

function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Public upload path, or null when the URL is not a library file we can resize. */
export function uploadPath(raw: string): string | null {
  const value = decodeAttr(raw).trim();
  if (!value.startsWith("/uploads/") || value.startsWith("/uploads//")) return null;
  const path = value.split(/[?#]/)[0] ?? "";
  if (!path || path.includes("..") || /[\s"'<>]/.test(path)) return null;
  if (path.toLowerCase().endsWith(".svg")) return null;
  return path;
}

/** True when `lower[index]` ends a tag name (`<script>`, `</script >`, `<script\n`). */
function tagNameEnds(lower: string, index: number): boolean {
  const ch = lower[index];
  return ch === undefined || ch === ">" || ch === "/" || /\s/.test(ch);
}

/** Index just past the `</name ...>` that closes a raw-text element, or the end of input. */
function rawTextEnd(lower: string, name: string, from: number): number {
  const close = `</${name}`;
  let at = lower.indexOf(close, from);
  while (at !== -1 && !tagNameEnds(lower, at + close.length)) at = lower.indexOf(close, at + 1);
  if (at === -1) return lower.length;
  const gt = lower.indexOf(">", at + close.length);
  return gt === -1 ? lower.length : gt + 1;
}

/**
 * Comments, `<script>`, and `<textarea>` spans. Scanned with `indexOf` rather
 * than one lazy regex so hostile input cannot trigger polynomial backtracking,
 * and close tags with trailing whitespace (`</script >`) still end the span.
 * An unclosed span runs to the end of the input, as it does in the browser.
 */
function protectedSpans(html: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const lower = html.toLowerCase();
  const opener = new RegExp(PROTECTED_OPEN_RE, "gi");
  let match: RegExpExecArray | null;
  while ((match = opener.exec(lower)) !== null) {
    const start = match.index;
    let end: number;
    if (match[0] === "<!--") {
      const close = lower.indexOf("-->", start + 4);
      end = close === -1 ? lower.length : close + 3;
    } else {
      const name = match[0].slice(1);
      if (!tagNameEnds(lower, start + match[0].length)) continue;
      end = rawTextEnd(lower, name, start + match[0].length);
    }
    spans.push([start, end]);
    opener.lastIndex = end;
  }
  return spans;
}

function inSpan(spans: Array<[number, number]>, index: number): boolean {
  return spans.some(([start, end]) => index >= start && index < end);
}

function insidePicture(html: string, index: number): boolean {
  const open = Math.max(html.lastIndexOf("<picture", index), html.lastIndexOf("<PICTURE", index));
  if (open === -1) return false;
  const close = Math.max(html.lastIndexOf("</picture>", index), html.lastIndexOf("</PICTURE>", index));
  return open > close;
}

function attrsOf(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const match of tag.matchAll(ATTR_RE)) {
    const name = match[1]!.toLowerCase();
    if (name === "img") continue;
    if (!attrs.has(name)) attrs.set(name, decodeAttr(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return attrs;
}

function cssUrl(url: string): string {
  const safe = safeMediaSrc(url);
  return safe ? `url(&quot;${safe}&quot;)` : "";
}

function largestCandidate(srcset: string): string {
  let bestWidth = -1;
  let best = "";
  for (const part of srcset.split(",")) {
    const tokens = part.trim().split(/\s+/);
    const url = tokens[0] ?? "";
    const descriptor = tokens[1] ?? "";
    const width = descriptor.endsWith("w") ? Number(descriptor.slice(0, -1)) : 0;
    if (url && width >= bestWidth) {
      bestWidth = width;
      best = url;
    }
  }
  return best;
}

function mimeFor(url: string): string {
  const path = url.toLowerCase();
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".avif")) return "image/avif";
  if (path.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

/** `background-image` value that prefers AVIF, then WebP, then the sized fallback. */
export function responsiveBackground(prop: ResponsiveProp): string {
  const fallback = cssUrl(prop.src);
  if (!fallback) return "";
  const candidates: string[] = [];
  for (const source of prop.sources) {
    if (!/^image\/[a-z0-9.+-]{2,40}$/i.test(source.type)) continue;
    const url = cssUrl(largestCandidate(source.srcset));
    if (url) candidates.push(`${url} type(&quot;${esc(source.type)}&quot;)`);
  }
  const fallbackType = mimeFor(prop.src);
  const fallbackCandidate = `${fallback} type(&quot;${fallbackType}&quot;)`;
  if (!candidates.some((candidate) => candidate.startsWith(fallback))) candidates.push(fallbackCandidate);
  if (prop.sources.length === 0) return `background-image:${fallback}`;
  return `background-image:${fallback};background-image:image-set(${candidates.join(", ")})`;
}

function imageMarkup(tag: string, prop: ResponsiveProp): string {
  const attrs = attrsOf(tag);
  const loading = attrs.get("loading") === "eager" ? "eager" : "lazy";
  const input = applyResponsiveProp(
    {
      src: prop.src,
      alt: attrs.get("alt") ?? "",
      loading,
      className: attrs.get("class") || undefined,
      sizes: attrs.get("sizes") || undefined,
    },
    prop,
  );
  let markup = renderResponsiveImage(input);
  // Theme and plugin CSS owns display, width, and object-fit. The core image
  // helper's inline style would override that.
  markup = markup.replace(/\sstyle="display:block;max-width:100%"/, "");
  if (markup.startsWith("<picture>")) {
    markup = markup.replace("<picture>", '<picture class="jf-responsive" style="display:contents">');
  }
  const id = attrs.get("id");
  if (id && /^[A-Za-z][\w:-]{0,80}$/.test(id)) {
    markup = markup.replace("<img ", `<img id="${esc(id)}" `);
  }
  return markup;
}

function collectPaths(html: string): string[] {
  const spans = protectedSpans(html);
  const paths = new Set<string>();
  for (const match of html.matchAll(IMG_RE)) {
    if (match.index === undefined || inSpan(spans, match.index) || insidePicture(html, match.index)) continue;
    const attrs = attrsOf(match[0]);
    if (attrs.has("srcset")) continue;
    const path = uploadPath(attrs.get("src") ?? "");
    if (path) paths.add(path);
  }
  for (const match of html.matchAll(BG_RE)) {
    if (match.index === undefined || inSpan(spans, match.index)) continue;
    const path = uploadPath(match[1] ?? "");
    if (path) paths.add(path);
  }
  return [...paths];
}

/**
 * Rewrite upload images in already-rendered HTML. `byUrl` is keyed by the
 * original `/uploads/...` path stored on the media row.
 */
export function rewriteResponsiveHtml(html: string, byUrl: Map<string, ResponsiveProp>): string {
  if (!html || byUrl.size === 0) return html;
  const spans = protectedSpans(html);
  const edits: Replacement[] = [];

  for (const match of html.matchAll(IMG_RE)) {
    if (match.index === undefined || inSpan(spans, match.index) || insidePicture(html, match.index)) continue;
    const attrs = attrsOf(match[0]);
    if (attrs.has("srcset")) continue;
    const path = uploadPath(attrs.get("src") ?? "");
    const prop = path ? byUrl.get(path) : undefined;
    if (!path || !prop) continue;
    const next = imageMarkup(match[0], prop);
    if (!next || next === match[0]) continue;
    edits.push({ start: match.index, end: match.index + match[0].length, html: next });
  }

  for (const match of html.matchAll(BG_RE)) {
    if (match.index === undefined || inSpan(spans, match.index)) continue;
    // The sized fallback sits in front of image-set(). A second pass must not
    // treat that fallback as another original.
    if (html.startsWith(";background-image:image-set", match.index + match[0].length)) continue;
    const path = uploadPath(match[1] ?? "");
    const prop = path ? byUrl.get(path) : undefined;
    if (!path || !prop) continue;
    const next = responsiveBackground(prop);
    if (!next) continue;
    edits.push({ start: match.index, end: match.index + match[0].length, html: next });
  }

  if (edits.length === 0) return html;
  edits.sort((a, b) => b.start - a.start);
  let out = html;
  let cursor = html.length;
  for (const edit of edits) {
    if (edit.end > cursor) continue;
    out = out.slice(0, edit.start) + edit.html + out.slice(edit.end);
    cursor = edit.start;
  }
  return out;
}

/**
 * Resolve derivatives for every bare upload image in `html` and rewrite them.
 * No-op when responsive markup is off, or when nothing in the HTML points at
 * an uploaded file.
 */
export async function upgradeResponsiveHtml(
  html: string,
  siteId?: string | null,
  load: typeof loadResponsiveProps = loadResponsiveProps,
): Promise<string> {
  if (!html || !responsiveMarkupEnabled()) return html;
  if (!/<img\b|background-image\s*:/i.test(html)) return html;
  const paths = collectPaths(html);
  if (paths.length === 0) return html;
  const byUrl = await load(paths, siteId);
  return rewriteResponsiveHtml(html, byUrl);
}
