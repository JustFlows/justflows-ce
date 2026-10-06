// SPDX-License-Identifier: MIT

import { getTenantContext } from "../tenancy/context.js";

/**
 * The site this plugin call belongs to. A request uses the site the host
 * resolved. Boot and background work keep the site the plugin was activated for.
 */
export function pluginCallSiteId(activatedSiteId: string): string {
  return getTenantContext()?.siteId || activatedSiteId;
}
