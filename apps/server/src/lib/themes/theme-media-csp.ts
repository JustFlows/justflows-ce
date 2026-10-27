// SPDX-License-Identifier: MIT
import { getActiveTheme, getSiteId, themeInstalledPath } from "./themes-db.js";
import { loadThemeMediaOrigins } from "./theme-files.js";

/** Site/request-scoped; never reuse another tenant's active theme or origins. */
export async function getThemeMediaOriginsForCsp(): Promise<string[]> {
  const siteId = await getSiteId();
  const theme = siteId ? await getActiveTheme(siteId) : null;
  return theme ? loadThemeMediaOrigins(theme.theme_id, themeInstalledPath(theme) ?? undefined) : [];
}

/** Explicit media policies and default-src 'none' remain authoritative. */
export function withThemeMediaCsp(csp: string, origins: string[]): string {
  const directives = csp.split(";").map(part => part.trim()).filter(Boolean);
  if (directives.some(part => /^media-src(?:\s|$)/i.test(part))) return csp;
  const inherited = directives.find(part => /^default-src(?:\s|$)/i.test(part))?.split(/\s+/).slice(1) ?? [];
  if (inherited.includes("'none'")) return csp;
  const valid = origins.filter(origin => {
    try { const url = new URL(origin); return url.protocol === "https:" && url.origin === origin && !url.username && !url.password; }
    catch { return false; }
  });
  if (!valid.length) return csp;
  return [...directives, `media-src ${[...new Set([...inherited, ...valid])].join(" ")}`].join("; ");
}
