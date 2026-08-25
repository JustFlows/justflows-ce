import en from "../../../src/lib/i18n/admin-catalogs/en.json";

type Messages = Record<string, string>;

function flattenCatalog(obj: Record<string, unknown>, prefix = ""): Messages {
  const out: Messages = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out[fullKey] = value;
    } else if (value && typeof value === "object") {
      Object.assign(out, flattenCatalog(value as Record<string, unknown>, fullKey));
    }
  }
  return out;
}

/** Bundled English catalog — used when /api/i18n is unavailable. */
export const EMBEDDED_EN = flattenCatalog(en as Record<string, unknown>);
