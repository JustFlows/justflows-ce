/** BCP 47 locale utilities. Site languages are whatever tags the site enables. */

export interface LanguageMeta {
  code: string;
  name: string;
  nativeName: string;
}

/** Last-resort tag when a site has no languages row yet. */
export const DEFAULT_CONTENT_LOCALE = "en-US";

/**
 * Common tags offered in the install wizard. Any valid BCP 47 code is still
 * accepted if the installer picks Other.
 */
export const INSTALL_LOCALE_CODES = [
  "en-US",
  "en-GB",
  "nl-NL",
  "de-DE",
  "fr-FR",
  "es-ES",
  "it-IT",
  "pt-BR",
  "pt-PT",
  "pl-PL",
  "cs-CZ",
  "sv-SE",
  "da-DK",
  "nb-NO",
  "fi-FI",
  "ja-JP",
  "ko-KR",
  "zh-CN",
  "zh-TW",
] as const;

/** Admin chrome catalogs we ship (not public content languages). */
export const ADMIN_UI_LOCALES = ["en", "nl", "de", "fr", "es"] as const;
export type AdminUiLocale = (typeof ADMIN_UI_LOCALES)[number];

/**
 * language, optional script, optional region, optional variants.
 * Examples: en, nl-NL, en-US, zh-Hant-TW.
 */
const LOCALE_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?(?:-[A-Za-z]{2}|-\d{3})?(?:-[A-Za-z0-9]{5,8})*$/;

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** Canonical BCP 47 casing. Does not invent a region for a language-only tag. */
export function normalizeLocale(input: string | undefined | null): string | null {
  if (!input) return null;
  const raw = input.trim().replaceAll("_", "-");
  if (!LOCALE_RE.test(raw)) return null;

  const parts = raw.split("-").filter(Boolean);
  const language = parts[0]?.toLowerCase();
  if (!language || language.length < 2 || language.length > 3) return null;

  const out = [language];
  for (const part of parts.slice(1)) {
    if (/^[A-Za-z]{4}$/.test(part)) out.push(titleCase(part));
    else if (/^[A-Za-z]{2}$/.test(part)) out.push(part.toUpperCase());
    else if (/^\d{3}$/.test(part)) out.push(part);
    else out.push(part.toLowerCase());
  }
  return out.join("-");
}

/** Exact match against enabled tags after canonical casing. No language-family aliases. */
export function matchActiveLocale(
  input: string | undefined | null,
  active: string[],
): string | null {
  if (active.length === 0) return null;
  const normalized = normalizeLocale(input);
  if (!normalized) return null;
  const found = active.find((code) => (normalizeLocale(code) ?? code) === normalized);
  return found ?? null;
}

/** Parse Accept-Language and return the best exact match among active tags. */
export function pickLocaleFromHeader(header: string | undefined, active: string[]): string | null {
  if (!header || active.length === 0) return null;

  const prefs = header
    .split(",")
    .map((part) => {
      const [tag, qPart] = part.trim().split(";q=");
      const q = qPart ? parseFloat(qPart) : 1;
      const canonical = normalizeLocale(tag);
      return canonical ? { canonical, q } : null;
    })
    .filter((p): p is { canonical: string; q: number } => p !== null)
    .sort((a, b) => b.q - a.q);

  for (const pref of prefs) {
    const matched = matchActiveLocale(pref.canonical, active);
    if (matched) return matched;
  }

  return null;
}

export function formatDate(date: Date | string, locale: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  try {
    return new Intl.DateTimeFormat(normalizeLocale(locale) ?? locale, { dateStyle: "long" }).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

function displayName(code: string, type: Intl.DisplayNamesOptions["type"], ofLocale: string): string {
  try {
    return new Intl.DisplayNames([ofLocale], { type }).of(code) ?? "";
  } catch {
    return "";
  }
}

/** Names for any valid tag via Intl — not a hardcoded language list. */
export function metaForCode(code: string): LanguageMeta {
  const normalized = normalizeLocale(code);
  if (!normalized) {
    return { code: code.trim(), name: code.trim(), nativeName: code.trim() };
  }

  const inEnglish = displayName(normalized, "language", "en") || normalized;
  const native = displayName(normalized, "language", normalized) || inEnglish;
  return { code: normalized, name: inEnglish, nativeName: native };
}

/** Compact switcher label is the tag itself (`NL-NL`, `EN-US`). */
export function displayLocaleCode(code: string): string {
  return (normalizeLocale(code) ?? code).toUpperCase();
}

export interface LocalePresentation {
  shortCode: string;
  flag: string;
  countryName: string;
}

/** Labels shared by public language selectors for any valid BCP 47 tag. */
export function localePresentation(code: string): LocalePresentation {
  const normalized = normalizeLocale(code);
  const shortCode = (normalized ?? code).split("-")[0]?.toLowerCase() || code;
  if (!normalized) return { shortCode, flag: "🌐", countryName: code };
  try {
    const locale = new Intl.Locale(normalized);
    const region = locale.region || locale.maximize().region;
    const flag = region && /^[A-Z]{2}$/.test(region)
      ? String.fromCodePoint(...[...region].map((letter) => 127397 + letter.charCodeAt(0)))
      : "🌐";
    const countryName = region
      ? new Intl.DisplayNames([normalized], { type: "region" }).of(region) || region
      : normalized;
    return { shortCode, flag, countryName };
  } catch {
    return { shortCode, flag: "🌐", countryName: code };
  }
}

/**
 * First path segments that are app routes, not public pages. Menu items and
 * language switching must not prefix these with a locale.
 */
export const UNLOCALIZED_PATH_SEGMENTS = new Set([
  "admin",
  "api",
  "install",
  "login",
  "register",
  "uploads",
  "assets",
  "css-providers",
  "favicon.ico",
  "forgot-password",
  "ext",
  "preview",
  "vendor",
  ".well-known",
  "justflows-comments",
  "justflows-analytics",
  "justflows-forms",
]);

/** Build a public URL path with optional locale prefix (default locale has no prefix). */
export function localePath(locale: string, path: string, defaultLocale: string): string {
  const loc = normalizeLocale(locale) ?? locale;
  const def = normalizeLocale(defaultLocale) ?? defaultLocale;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (loc === def) return normalized === "/" ? "/" : normalized;
  if (normalized === "/") return `/${loc}`;
  return `/${loc}${normalized}`;
}

function withLeadingSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

/** Parse optional locale prefix from a URL path. */
export function parseLocalePrefix(path: string, activeLocales: string[]): {
  locale: string | null;
  restPath: string;
} {
  const normalized = withLeadingSlash(path);
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return { locale: null, restPath: "/" };

  const matched = matchActiveLocale(segments[0], activeLocales);
  if (matched) {
    const rest = segments.slice(1).join("/");
    return { locale: matched, restPath: rest ? `/${rest}` : "/" };
  }

  return { locale: null, restPath: normalized };
}

/**
 * Prefix a site-internal path with the current locale, stripping any existing
 * locale prefix first. External URLs, hashes, and reserved app routes stay as-is.
 */
export function localizePublicPath(
  path: string,
  locale: string,
  defaultLocale: string,
  activeLocales: string[],
): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "#") return trimmed || "#";
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return trimmed;

  const { restPath } = parseLocalePrefix(trimmed, activeLocales);
  const first = restPath.split("/").filter(Boolean)[0];
  if (first && UNLOCALIZED_PATH_SEGMENTS.has(first)) return restPath;
  return localePath(locale, restPath, defaultLocale);
}

export interface LocalizeHtmlLinksOptions {
  locale: string;
  defaultLocale: string;
  activeLocales: string[];
  /** Extra app routes to leave alone (for example plugin HTTP routes). */
  isAppRoute?: (pathname: string) => boolean;
}

const LINK_TAG_RE = /<(a|form)\b[^>]*>/gi;
const LINK_ATTR_RE = /(\s(?:href|action)\s*=\s*)(["'])(\/(?!\/)[^"']*)\2/i;

/**
 * Give every site-internal `<a href>` and `<form action>` in a rendered public
 * page the page's locale prefix, so blocks, themes and plugins can link to
 * `/shop` and still keep a `/nl-NL` visitor in Dutch. Paths that already carry
 * a locale, app routes, files (a dot in the last segment) and anchors with
 * `hreflang` (language switchers) are left as-is. The default locale is a no-op.
 */
export function localizeHtmlLinks(html: string, opts: LocalizeHtmlLinksOptions): string {
  const loc = normalizeLocale(opts.locale) ?? opts.locale;
  const def = normalizeLocale(opts.defaultLocale) ?? opts.defaultLocale;
  if (loc === def) return html;

  return html.replace(LINK_TAG_RE, (tag) => {
    if (/\shreflang\s*=/i.test(tag)) return tag;
    return tag.replace(LINK_ATTR_RE, (whole, prefix: string, quote: string, url: string) => {
      const cut = url.search(/[?#]/);
      const pathname = cut === -1 ? url : url.slice(0, cut);
      const suffix = cut === -1 ? "" : url.slice(cut);
      const segments = pathname.split("/").filter(Boolean);
      const first = segments[0];
      const last = segments[segments.length - 1] ?? "";
      if (first && matchActiveLocale(first, opts.activeLocales)) return whole;
      if (first && UNLOCALIZED_PATH_SEGMENTS.has(first)) return whole;
      if (last.includes(".")) return whole;
      if (opts.isAppRoute?.(pathname)) return whole;
      return `${prefix}${quote}${localePath(loc, pathname, def)}${suffix}${quote}`;
    });
  });
}
