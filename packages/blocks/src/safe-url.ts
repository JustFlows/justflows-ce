/**
 * Escape HTML attribute/text content.
 *
 * Apostrophes are escaped too. Nearly every attribute here is double-quoted, but
 * core.hero nests a single-quoted CSS url() inside one — leaving ' literal let a
 * media URL close the url() and append CSS declarations.
 */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const UNSAFE_PROTOCOL = /^(javascript|data|vbscript):/i;

/** Strip unsafe URL schemes for storage (no HTML escaping). */
export function sanitizeHref(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "#";

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }

  if (UNSAFE_PROTOCOL.test(trimmed)) return "#";

  // Match the scheme without requiring "//", so mailto: — which is on the
  // allowlist but has no authority component — is not silently rewritten to "#".
  // Anything not explicitly allowed still falls through to the default deny.
  const match = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
  if (match) {
    const protocol = match[1]!.toLowerCase();
    if (protocol === "http" || protocol === "https" || protocol === "mailto") {
      return trimmed;
    }
    return "#";
  }

  return "#";
}

/** Strip unsafe media URL schemes for storage (no HTML escaping). */
export function sanitizeMediaSrc(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }

  if (UNSAFE_PROTOCOL.test(trimmed)) return "";

  const match = trimmed.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (match) {
    const protocol = match[1]!.toLowerCase();
    if (protocol === "http" || protocol === "https") {
      return trimmed;
    }
  }

  return "";
}

/** Return a safe href for use in rendered anchors, or "#" if unsafe. */
export function safeHref(url: string): string {
  const safe = sanitizeHref(url);
  return safe === "#" ? "#" : esc(safe);
}

/** Return a safe image/media src, or empty string if unsafe. */
export function safeMediaSrc(url: string): string {
  const safe = sanitizeMediaSrc(url);
  return safe ? esc(safe) : "";
}
