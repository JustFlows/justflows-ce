import path from "node:path";
import { getJfRoot } from "../runtime/jf-root.js";

export function packagesInstalledDir(): string {
  const rel = process.env.PACKAGES_DIR ?? "packages-installed";
  return path.isAbsolute(rel) ? rel : path.join(getJfRoot(), rel);
}

const SITE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Themes that belong to one site ("Save as new theme" forks), kept apart from
 * shared marketplace packages so a site's folder holds only its own files:
 * `packages-installed/sites/<siteId>/themes/<themeId>/`. Null for an unsafe id.
 */
export function siteThemesDir(siteId: string): string | null {
  if (!SITE_ID_RE.test(siteId)) return null;
  return path.join(packagesInstalledDir(), "sites", siteId, "themes");
}
