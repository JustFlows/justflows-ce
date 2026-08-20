/**
 * Parsing and re-serialising for the two headers that carry a whole policy
 * rather than a single token. The editors work on the structured form; the
 * stored value stays a plain string so nothing is lost if someone hand-edits it.
 */

// ─── Content Security Policy ─────────────────────────────────────────────────

export type CspDirective = { name: string; value: string };

/** Directives worth offering in the picker, roughly in the order people add them. */
export const CSP_DIRECTIVES = [
  "default-src",
  "script-src",
  "script-src-elem",
  "script-src-attr",
  "style-src",
  "style-src-elem",
  "style-src-attr",
  "img-src",
  "font-src",
  "connect-src",
  "media-src",
  "object-src",
  "frame-src",
  "child-src",
  "worker-src",
  "manifest-src",
  "prefetch-src",
  "frame-ancestors",
  "form-action",
  "base-uri",
  "sandbox",
  "upgrade-insecure-requests",
  "block-all-mixed-content",
  "report-uri",
  "report-to",
  "require-trusted-types-for",
  "trusted-types",
];

/** Common source values, offered as one-click chips inside a directive row. */
export const CSP_SOURCE_KEYWORDS = [
  "'self'",
  "'none'",
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'strict-dynamic'",
  "data:",
  "blob:",
  "https:",
  "*",
];

/** Directives that take no source list — they are switches. */
export const CSP_VALUELESS_DIRECTIVES = new Set([
  "upgrade-insecure-requests",
  "block-all-mixed-content",
]);

export function parseCsp(value: string): CspDirective[] {
  const out: CspDirective[] = [];
  const seen = new Set<string>();
  for (const part of value.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    const name = tokens.shift();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: key, value: tokens.join(" ") });
  }
  return out;
}

export function serializeCsp(directives: CspDirective[]): string {
  return directives
    .map((d) => `${d.name}${d.value.trim() ? ` ${d.value.trim()}` : ""}`)
    .filter((s) => s.trim().length > 0)
    .join("; ");
}

// ─── Permissions Policy ──────────────────────────────────────────────────────

export type PermissionEntry = { feature: string; allowlist: string };

/**
 * The features browsers actually gate today. Anything not listed can still be
 * added by hand through the raw editor.
 */
export const PERMISSIONS_FEATURES = [
  "accelerometer",
  "ambient-light-sensor",
  "autoplay",
  "battery",
  "bluetooth",
  "camera",
  "clipboard-read",
  "clipboard-write",
  "cross-origin-isolated",
  "display-capture",
  "encrypted-media",
  "fullscreen",
  "gamepad",
  "geolocation",
  "gyroscope",
  "hid",
  "idle-detection",
  "local-fonts",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "picture-in-picture",
  "publickey-credentials-create",
  "publickey-credentials-get",
  "screen-wake-lock",
  "serial",
  "speaker-selection",
  "storage-access",
  "usb",
  "web-share",
  "window-management",
  "xr-spatial-tracking",
];

/** The three answers that cover almost every case, plus an escape hatch. */
export type PermissionChoice = "none" | "self" | "all" | "custom";

export function permissionChoiceOf(allowlist: string): PermissionChoice {
  const normalized = allowlist.trim().toLowerCase();
  if (normalized === "()" || normalized === "") return "none";
  if (normalized === "(self)" || normalized === "self") return "self";
  if (normalized === "*") return "all";
  return "custom";
}

export function allowlistForChoice(choice: PermissionChoice, current: string): string {
  if (choice === "none") return "()";
  if (choice === "self") return "(self)";
  if (choice === "all") return "*";
  return current.trim() === "()" || current.trim() === "(self)" || current.trim() === "*"
    ? "(self \"https://example.com\")"
    : current;
}

export function parsePermissionsPolicy(value: string): PermissionEntry[] {
  const out: PermissionEntry[] = [];
  const seen = new Set<string>();
  // Split on commas that are not inside parentheses.
  let depth = 0;
  let current = "";
  const parts: string[] = [];
  for (const ch of value) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const feature = trimmed.slice(0, eq).trim().toLowerCase();
    if (!feature || seen.has(feature)) continue;
    seen.add(feature);
    out.push({ feature, allowlist: trimmed.slice(eq + 1).trim() });
  }
  return out;
}

export function serializePermissionsPolicy(entries: PermissionEntry[]): string {
  return entries
    .filter((e) => e.feature.trim())
    .map((e) => `${e.feature.trim()}=${e.allowlist.trim() || "()"}`)
    .join(", ");
}

// ─── Strict Transport Security ───────────────────────────────────────────────

export type HstsParts = { maxAge: number; includeSubDomains: boolean; preload: boolean };

export function parseHsts(value: string): HstsParts {
  const match = /max-age\s*=\s*"?(\d+)"?/i.exec(value);
  return {
    maxAge: match?.[1] ? Number(match[1]) : 31536000,
    includeSubDomains: /includeSubDomains/i.test(value),
    preload: /preload/i.test(value),
  };
}

export function serializeHsts(parts: HstsParts): string {
  const bits = [`max-age=${Math.max(0, Math.floor(parts.maxAge))}`];
  if (parts.includeSubDomains) bits.push("includeSubDomains");
  if (parts.preload) bits.push("preload");
  return bits.join("; ");
}

export const HSTS_PRESETS = [
  { label: "5 minutes — for testing", seconds: 300 },
  { label: "1 day", seconds: 86400 },
  { label: "6 months — preload minimum", seconds: 15768000 },
  { label: "1 year — recommended", seconds: 31536000 },
  { label: "2 years — preload list default", seconds: 63072000 },
];
