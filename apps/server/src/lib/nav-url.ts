const UNSAFE_PROTOCOL = /^(javascript|data|vbscript):/i;

/** Returns true when a URL is safe to use in public navigation links. */
export function isAllowedNavUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed === "#") return true;

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;

  if (UNSAFE_PROTOCOL.test(trimmed)) return false;

  const match = trimmed.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (match) {
    const protocol = match[1]!.toLowerCase();
    return protocol === "http" || protocol === "https" || protocol === "mailto";
  }

  return false;
}

export function assertAllowedNavUrl(url: string | undefined): void {
  if (!url?.trim()) return;
  if (!isAllowedNavUrl(url)) {
    throw new Error(`Invalid menu URL: ${url}`);
  }
}

export function sanitizeNavUrl(url: string | undefined): string {
  if (!url?.trim()) return "#";
  return isAllowedNavUrl(url) ? url.trim() : "#";
}
