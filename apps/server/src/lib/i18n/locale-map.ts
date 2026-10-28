// SPDX-License-Identifier: MIT

/** A localized setting stored as one string (the default locale's) or a `{ locale: text }` map. */
export function asLocaleMap(value: unknown, defaultLocale: string): Record<string, string> {
  if (typeof value === "string") return value ? { [defaultLocale]: value } : {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const out: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === "string") out[key] = entry;
    }
    return out;
  }
  return {};
}

export function localizedString(
  value: unknown,
  locale: string,
  defaultLocale: string,
  fallback = "",
): string {
  if (typeof value === "string") return value;
  const map = asLocaleMap(value, defaultLocale);
  const exact = map[locale]?.trim();
  if (exact) return exact;
  const def = map[defaultLocale]?.trim();
  if (def) return def;
  const first = Object.values(map).find((entry) => entry.trim());
  return first ?? fallback;
}
