// SPDX-License-Identifier: MIT

import { blockAssetMarker } from "@justflows/blocks";

/**
 * Files a plugin or theme loads only on pages that need them: either for one
 * block type (`assets.blocks`) or for pages containing some markup
 * (`assets.markup`).
 */
export interface PageAssetEntry {
  /** A block type; the page must carry its `<!--jf-block:<type>-->` marker. */
  type?: string;
  /** Selectors (`#id`, `.class`, `.prefix*`, `[attribute]`); the page must contain any one. */
  match?: readonly string[];
  scripts: readonly string[];
  styles: readonly string[];
  /** The URL to link for one of this entry's files. */
  href: (rel: string) => string;
}

/** The selector grammar `assets.markup` accepts (mirrors `AssetMarkupSelectorSchema` in the SDK). */
export const MARKUP_SELECTOR = /^(?:#[A-Za-z][A-Za-z0-9_-]{0,63}|\.[A-Za-z_][A-Za-z0-9_-]{0,63}\*?|\[[a-z][a-z0-9-]{0,63}\])$/;

const compiled = new Map<string, RegExp | null>();

/** `text` as a literal inside a regular expression. */
function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
}

/** The regex that finds `selector` in serialized HTML, or null for one outside the grammar. */
function selectorRegex(selector: string): RegExp | null {
  if (compiled.has(selector)) return compiled.get(selector)!;
  let re: RegExp | null = null;
  if (MARKUP_SELECTOR.test(selector)) {
    const prefix = selector.endsWith("*");
    const name = escapeRegExp(prefix ? selector.slice(1, -1) : selector.slice(1, selector.startsWith("[") ? -1 : undefined));
    if (selector.startsWith("#")) {
      re = new RegExp(`\\sid=(["'])${name}\\1`);
    } else if (selector.startsWith(".")) {
      re = new RegExp(`\\sclass=(["'])(?:(?!\\1)[^>])*?(?<=["'\\s])${name}${prefix ? "[^\\s\"'>]*" : ""}(?=[\\s"'])`);
    } else {
      re = new RegExp(`<[A-Za-z][^>]*?\\s${name}(?=[\\s=>/])`);
    }
  }
  if (compiled.size < 1000) compiled.set(selector, re);
  return re;
}

/** Whether `html` contains an element matching `selector`. */
export function markupMatches(html: string, selector: string): boolean {
  return selectorRegex(selector)?.test(html) ?? false;
}

function entryApplies(entry: PageAssetEntry, html: string): boolean {
  if (entry.type) {
    const marker = blockAssetMarker(entry.type);
    if (marker && html.includes(marker)) return true;
  }
  return (entry.match ?? []).some((selector) => markupMatches(html, selector));
}

/**
 * Tags for the entries the finished page `html` needs: stylesheets (linked
 * before the theme stylesheet, so the theme and the site's Additional CSS
 * still win) and deferred scripts for the end of the body. A file several
 * entries share is linked once.
 */
export function pageAssetTags(entries: Iterable<PageAssetEntry>, html: string): { styles: string[]; body: string[] } {
  const styles: string[] = [];
  const body: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entryApplies(entry, html)) continue;
    for (const [rels, list, tag] of [
      [entry.styles, styles, (href: string) => `<link rel="stylesheet" href="${href}">`],
      [entry.scripts, body, (href: string) => `<script src="${href}" defer></script>`],
    ] as const) {
      for (const rel of rels) {
        const href = entry.href(rel);
        if (seen.has(href)) continue;
        seen.add(href);
        list.push(tag(href));
      }
    }
  }
  return { styles, body };
}

/**
 * `assets.markup` rules with existing files: each `{ match, scripts, styles }`
 * keeps its valid selectors and the files `pick` accepts. At most 20 rules.
 */
export function readMarkupAssets(
  spec: unknown,
  pick: (list: unknown) => string[],
): Array<{ match: string[]; scripts: string[]; styles: string[] }> {
  if (!Array.isArray(spec)) return [];
  const out: Array<{ match: string[]; scripts: string[]; styles: string[] }> = [];
  for (const raw of spec.slice(0, 20)) {
    if (!raw || typeof raw !== "object") continue;
    const rule = raw as { match?: unknown; scripts?: unknown; styles?: unknown };
    const match = Array.isArray(rule.match)
      ? rule.match.slice(0, 20).filter((value): value is string => typeof value === "string" && MARKUP_SELECTOR.test(value))
      : [];
    const scripts = pick(rule.scripts);
    const styles = pick(rule.styles);
    if (match.length && (scripts.length || styles.length)) out.push({ match, scripts, styles });
  }
  return out;
}

/**
 * Point the relative `url()`s of a stylesheet served from `baseUrl` (a path
 * ending in `/`) at the same files once its text is inlined elsewhere.
 */
export function rebaseCssUrls(css: string, baseUrl: string): string {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (match, quote: string, ref: string) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(ref.trim())) return match;
    return `url(${quote}${baseUrl}${ref.trim()}${quote})`;
  });
}

/** Per-page stylesheet files of one plugin or theme, for the page builder canvas. */
export function readPerPageStyles(
  entries: ReadonlyArray<{ styles: readonly string[] }>,
  read: (rel: string) => string | null,
  baseUrl: (rel: string) => string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    for (const rel of entry.styles) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      const css = read(rel);
      if (css) out.push(rebaseCssUrls(css, baseUrl(rel)));
    }
  }
  return out;
}
