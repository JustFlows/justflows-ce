/** BCP 47 locale utilities and built-in language metadata. */

export interface LanguageMeta {
  code: string;
  name: string;
  nativeName: string;
}

/** Common languages available when adding a new site language. */
export const BUILTIN_LANGUAGES: LanguageMeta[] = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "pl", name: "Polish", nativeName: "Polski" },
  { code: "sv", name: "Swedish", nativeName: "Svenska" },
  { code: "da", name: "Danish", nativeName: "Dansk" },
  { code: "nb", name: "Norwegian", nativeName: "Norsk" },
  { code: "fi", name: "Finnish", nativeName: "Suomi" },
  { code: "cs", name: "Czech", nativeName: "Čeština" },
  { code: "hu", name: "Hungarian", nativeName: "Magyar" },
  { code: "ro", name: "Romanian", nativeName: "Română" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "he", name: "Hebrew", nativeName: "עברית" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "zh", name: "Chinese", nativeName: "中文" },
];

export const ADMIN_UI_LOCALES = ["en", "nl", "de", "fr", "es"] as const;
export type AdminUiLocale = (typeof ADMIN_UI_LOCALES)[number];

const LOCALE_RE = /^[a-z]{2}(-[A-Za-z0-9]+)?$/;

/** Normalize and validate a locale code (e.g. en, en-US, nl). */
export function normalizeLocale(input: string | undefined | null): string | null {
  if (!input) return null;
  const code = input.trim().toLowerCase().replace("_", "-");
  if (!LOCALE_RE.test(code)) return null;
  return code;
}

/** Parse Accept-Language header and return best matching active locale. */
export function pickLocaleFromHeader(header: string | undefined, active: string[]): string | null {
  if (!header || active.length === 0) return null;

  const prefs = header
    .split(",")
    .map((part) => {
      const [tag, qPart] = part.trim().split(";q=");
      const q = qPart ? parseFloat(qPart) : 1;
      const base = normalizeLocale(tag?.split("-")[0] ?? tag);
      return base ? { base, q } : null;
    })
    .filter((p): p is { base: string; q: number } => p !== null)
    .sort((a, b) => b.q - a.q);

  for (const pref of prefs) {
    const exact = active.find((l) => l === pref.base || l.startsWith(`${pref.base}-`));
    if (exact) return exact;
    const baseMatch = active.find((l) => l.split("-")[0] === pref.base);
    if (baseMatch) return baseMatch;
  }

  return null;
}

export function formatDate(date: Date | string, locale: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

export function metaForCode(code: string): LanguageMeta {
  const normalized = normalizeLocale(code) ?? "en";
  const found = BUILTIN_LANGUAGES.find((l) => l.code === normalized.split("-")[0]);
  return found ?? { code: normalized, name: normalized, nativeName: normalized };
}

/** Build a public URL path with optional locale prefix (default locale has no prefix). */
export function localePath(locale: string, path: string, defaultLocale: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (locale === defaultLocale) return normalized === "/" ? "/" : normalized;
  if (normalized === "/") return `/${locale}`;
  return `/${locale}${normalized}`;
}
