export type MessageCatalog = Record<string, string>;

export function createTranslator(catalog: MessageCatalog, fallback?: MessageCatalog) {
  return function t(key: string, vars?: Record<string, string | number>): string {
    let msg = catalog[key] ?? fallback?.[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        msg = msg.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return msg;
  };
}

export function flattenCatalog(obj: Record<string, unknown>, prefix = ""): MessageCatalog {
  const out: MessageCatalog = {};
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
