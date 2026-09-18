const SAFE_RELATIVE = /^\/(?!\/)/;

export function sanitizeFaviconUrl(url: string | undefined | null): string {
  if (!url) return "";
  const trimmed = url.trim();
  return isSafeAssetUrl(trimmed) ? trimmed : "";
}

export function isSafeAssetUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 2048) return false;
  if (SAFE_RELATIVE.test(trimmed) && !trimmed.includes("\\")) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function faviconMime(url: string): string | undefined {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".ico")) return "image/x-icon";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return undefined;
}

function escAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

/** `<link rel="icon">` tags for the public document head. */
export function buildFaviconHeadHtml(url: string): string {
  if (!isSafeAssetUrl(url)) return "";
  const href = escAttr(url.trim());
  const type = faviconMime(url);
  const typeAttr = type ? ` type="${type}"` : "";
  return [
    `<link rel="icon"${typeAttr} href="${href}">`,
    `<link rel="apple-touch-icon" href="${href}">`,
  ].join("\n");
}
