// SPDX-License-Identifier: MIT

/**
 * URL-path ⇆ output-file mapping for the static export.
 *
 * Pure string helpers with no filesystem access so they can be unit-tested and
 * reused by both the writer and the manifest/prune logic.
 */

const HAS_EXTENSION = /\.[a-z0-9]{1,8}$/i;

/** Strip the query/hash and collapse duplicate slashes; always keep a leading `/`. */
export function normalizeUrlPath(input: string): string {
  let value = input.trim();
  const cut = value.search(/[?#]/);
  if (cut !== -1) value = value.slice(0, cut);
  try {
    // Accept absolute URLs too — callers sometimes pass a full <loc>.
    if (/^https?:\/\//i.test(value)) value = new URL(value).pathname;
  } catch {
    // fall through with the raw value
  }
  value = value.replace(/\/{2,}/g, "/");
  if (!value.startsWith("/")) value = `/${value}`;
  if (value.length > 1) value = value.replace(/\/+$/, "");
  return value || "/";
}

/**
 * Map a URL path to a POSIX-style relative file path inside the output dir.
 *
 *   `/`                     → `index.html`
 *   `/about`                → `about/index.html`
 *   `/nl-NL/over-ons`       → `nl-NL/over-ons/index.html`
 *   `/sitemap.xml`          → `sitemap.xml`
 *   `/uploads/logo.png`     → `uploads/logo.png`
 */
export function urlPathToFile(urlPath: string, contentType?: string): string {
  const path = normalizeUrlPath(urlPath);
  if (path === "/") return "index.html";

  const rel = path.slice(1);
  const last = rel.slice(rel.lastIndexOf("/") + 1);

  // A trailing filename with an extension is written verbatim, unless the
  // response is HTML served from an extensionless-looking route (rare) — then
  // the content type wins and it still becomes a directory index.
  if (HAS_EXTENSION.test(last)) {
    if (contentType && contentType.includes("text/html") && !/\.html?$/i.test(last)) {
      return `${rel}/index.html`;
    }
    return rel;
  }
  return `${rel}/index.html`;
}

/** Reject paths that escape the output directory once joined. */
export function isSafeRelativeFile(rel: string): boolean {
  if (!rel || rel.startsWith("/") || rel.includes("\\")) return false;
  return rel.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}
