// SPDX-License-Identifier: MIT

import { getSiteId, getSiteSetting, setSiteSetting } from "../settings/site-settings.js";
import { isInstallationRootRequest } from "../tenancy/access.js";

/** Per-site opt-out. Missing means this website still follows the installation. */
export const STATIC_EXPORT_SITE_KEY = "static_export_enabled";

/** A stored `false` turns export off for that website. Anything else leaves it on. */
export function siteAllowsStaticExport(stored: unknown): boolean {
  return stored !== false && stored !== "false" && stored !== 0 && stored !== "0";
}

/** The installation site uses `STATIC_EXPORT_ENABLED`. Every other site can opt out. */
export async function isCurrentSiteStaticExportEnabled(): Promise<boolean> {
  if (isInstallationRootRequest()) return true;
  const siteId = await getSiteId();
  if (!siteId) return true;
  return siteAllowsStaticExport(await getSiteSetting<unknown>(siteId, STATIC_EXPORT_SITE_KEY));
}

export async function setCurrentSiteStaticExportEnabled(enabled: boolean): Promise<void> {
  const siteId = await getSiteId();
  if (!siteId) throw new Error("No site");
  await setSiteSetting(siteId, STATIC_EXPORT_SITE_KEY, enabled);
}
