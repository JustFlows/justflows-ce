// SPDX-License-Identifier: MIT

/**
 * The dependency-free fallback rendered for 500 (unhandled errors) and
 * maintenance mode (justflows-ce#92). Must never touch the database, cache,
 * or plugin runtime — the entire point is that it still renders when one of
 * those is the reason the request is failing. Locale detection is therefore
 * request-only (URL prefix, then `Accept-Language`) rather than the site's
 * configured active-locale list, which lives in the database.
 *
 * `server.js`'s pre-boot layer keeps its own small, independent copy of this
 * load-and-substitute logic (it runs before this compiled module exists on
 * disk). Both loaders point at the same `views/static/error-fallback.html`
 * and the same `lib/i18n/site-catalogs/*.json` files — those are the single
 * source of truth for the page's wording and design; keep the two loaders in
 * sync if the placeholder tokens or catalog keys ever change.
 */

import fs from "node:fs";
import path from "node:path";
import { getJfRoot, viewsDir } from "../runtime/jf-root.js";

export type StaticErrorKind = "500" | "maintenance";

/** The locales the bundled `site-catalogs/*.json` files ship translations for. */
export const STATIC_ERROR_LOCALES = ["en", "de", "es", "fr", "nl"] as const;

const DEFAULT_BADGE: Record<StaticErrorKind, string> = {
  "500": "Temporary error",
  maintenance: "Maintenance",
};

const DEFAULT_HEADING: Record<StaticErrorKind, string> = {
  "500": "Something went wrong",
  maintenance: "We'll be back soon",
};

const DEFAULT_MESSAGE: Record<StaticErrorKind, string> = {
  "500": "The site hit an unexpected error. Please try again shortly.",
  maintenance: "This site is down for planned maintenance. Please check back soon.",
};

// Resolve from the installation root: bundling relocates import.meta.url.
const catalogDirs = [
  path.join(getJfRoot(), "apps/server/dist/lib/i18n/site-catalogs"),
  path.join(getJfRoot(), "apps/server/src/lib/i18n/site-catalogs"),
];
const catalogCache = new Map<string, Record<string, string>>();

function loadStaticCatalog(locale: string): Record<string, string> {
  const cached = catalogCache.get(locale);
  if (cached) return cached;
  let data: Record<string, string> = {};
  for (const dir of catalogDirs) {
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, `${locale}.json`), "utf-8")) as Record<
        string,
        string
      >;
      break;
    } catch {
      // Try the source checkout before falling back to the default copy.
    }
  }
  catalogCache.set(locale, data);
  return data;
}

/**
 * The best of the bundled locales for this request, from the URL's locale
 * prefix (`/de/...`) or `Accept-Language` — never from the database, since
 * this path must work when it is unreachable. Defaults to English.
 */
export function detectStaticErrorLocale(
  pathname: string,
  acceptLanguageHeader?: string | null,
): string {
  const supported: readonly string[] = STATIC_ERROR_LOCALES;
  const prefix = pathname.split("/").find(Boolean)?.toLowerCase().split("-")[0];
  if (prefix && supported.includes(prefix)) return prefix;
  if (acceptLanguageHeader) {
    for (const part of acceptLanguageHeader.split(",")) {
      const code = part.split(";")[0]?.trim().toLowerCase().split("-")[0];
      if (code && supported.includes(code)) return code;
    }
  }
  return "en";
}

let cachedTemplate: string | null = null;

function loadTemplate(): string {
  if (cachedTemplate !== null) return cachedTemplate;
  const file = path.join(viewsDir(), "static", "error-fallback.html");
  cachedTemplate = fs.readFileSync(file, "utf-8");
  return cachedTemplate;
}

/** Not a tag-stripping regex — this only escapes the five HTML-significant characters. */
export function escapeStaticHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}

export interface StaticErrorPageVars {
  /** Admin-provided plain text, if any (`error_pages.500`/`.maintenance`). Wins over the catalog. */
  heading?: string;
  message?: string;
  siteTitle?: string;
  /** One of {@link STATIC_ERROR_LOCALES}, from {@link detectStaticErrorLocale}. Defaults to English. */
  locale?: string;
}

/**
 * Render the static 500/maintenance page. Falls back to a generic, English
 * default on any missing/blank/unreadable input rather than throwing — this
 * is the last line of defense when everything else, including the database,
 * may be down.
 */
export function renderStaticErrorPage(
  kind: StaticErrorKind,
  vars: StaticErrorPageVars = {},
): string {
  const catalog = loadStaticCatalog(vars.locale ?? "en");
  const siteTitle = vars.siteTitle?.trim() || "This site";
  const badge = catalog[`errors.${kind}.badge`] ?? DEFAULT_BADGE[kind];
  const heading = vars.heading?.trim() || catalog[`errors.${kind}.title`] || DEFAULT_HEADING[kind];
  const message = vars.message?.trim() || catalog[`errors.${kind}.body`] || DEFAULT_MESSAGE[kind];
  const template = loadTemplate();
  return template
    .replaceAll("{{TITLE}}", escapeStaticHtml(`${siteTitle} — ${heading}`))
    .replaceAll("{{SITE_TITLE}}", escapeStaticHtml(siteTitle))
    .replaceAll("{{BADGE}}", escapeStaticHtml(badge))
    .replaceAll("{{HEADING}}", escapeStaticHtml(heading))
    .replaceAll("{{MESSAGE}}", escapeStaticHtml(message));
}
