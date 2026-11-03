// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import { rememberPublic, THEME_MODS_PREFIX } from "../cache/public-cache.js";
import { cacheSiteId } from "../cache/site-cache-key.js";
import { getEffectiveThemeCss } from "./theme-customize.js";
import { loadThemeScripts } from "./theme-files.js";
import { getActiveTheme, getSiteId, themeInstalledPath } from "./themes-db.js";

/**
 * `?v=` versions for `/theme.css` and `/theme.js`. A page links the version of
 * what it was rendered with; the handler marks a response `immutable` only
 * when the requested version is the content it is sending, so a page cached
 * before a theme or Customizer change revalidates instead of pinning old bytes.
 * The memo lives in the theme cache layer, which a theme or Customizer change
 * clears.
 */

export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Short content hash used as a cache-busting version. */
export function contentVersion(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/** Version of the published `/theme.css`. */
export async function themeCssVersion(): Promise<string> {
  return rememberPublic(`${THEME_MODS_PREFIX}${cacheSiteId()}:asset-version:css`, async () =>
    contentVersion(await getEffectiveThemeCss(false)),
  );
}

/** The active theme's concatenated scripts ("" when it ships none). */
export async function activeThemeScripts(): Promise<string> {
  const siteId = await getSiteId();
  const theme = siteId ? await getActiveTheme(siteId) : null;
  return theme ? loadThemeScripts(theme.theme_id, themeInstalledPath(theme) ?? undefined) : "";
}

/** Version of `/theme.js`, or "" when the active theme ships no scripts. */
export async function themeScriptsVersion(): Promise<string> {
  return rememberPublic(`${THEME_MODS_PREFIX}${cacheSiteId()}:asset-version:js`, async () => {
    const scripts = await activeThemeScripts();
    return scripts ? contentVersion(scripts) : "";
  });
}
