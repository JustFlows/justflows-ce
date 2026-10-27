// SPDX-License-Identifier: MIT

import type { PluginNetworkApi, PluginNetworkSite } from "@justflows/sdk";
import { getControlDb, runWithDatabase } from "../database/db.js";
import { isInstallationRootRequest } from "../tenancy/access.js";
import { installationRootSiteId } from "../tenancy/registry.js";
import { getSiteId } from "../settings/site-settings.js";
import { getPluginSetting } from "./plugin-kv.js";

/**
 * `ctx.network` for a plugin holding `platform:network`. Reads go to the
 * installation database, so a site with its own database still sees the main
 * site's choices. Nothing here writes: the main site saves through its own
 * `ctx.settings`.
 */
export function createPluginNetworkApi(pluginId: string): PluginNetworkApi {
  return {
    mainSiteSettings: {
      async get<T = unknown>(key: string): Promise<T | undefined> {
        const rootId = await installationRootSiteId().catch(() => null);
        /** No tenancy tables: a single-site install is its own main site. */
        if (!rootId) {
          const siteId = await getSiteId();
          return siteId ? getPluginSetting<T>(pluginId, siteId, key) : undefined;
        }
        const control = await getControlDb();
        return runWithDatabase(control, () => getPluginSetting<T>(pluginId, rootId, key));
      },
    },
    async sites(): Promise<PluginNetworkSite[]> {
      if (!isInstallationRootRequest()) {
        throw new Error("Only the main site can list the sites in the installation.");
      }
      const rootId = await installationRootSiteId().catch(() => null);
      if (!rootId) return [];
      const control = await getControlDb();
      const rows = await control.query<{ id: string; name: string | null; hostname: string | null }>(
        `SELECT s.id, s.name, d.hostname
         FROM sites s
         LEFT JOIN site_domains d ON d.site_id = s.id AND d.is_primary = ?
         WHERE s.status <> 'deleted'
         ORDER BY s.created_at ASC, s.id ASC`,
        [true],
      );
      return rows.map((row) => ({
        id: String(row.id),
        name: String(row.name ?? ""),
        hostname: row.hostname ? String(row.hostname) : null,
        mainSite: String(row.id) === rootId,
      }));
    },
  };
}

const MAIN_SITE_PLUGINS_TTL_MS = 5000;
let mainSitePlugins: { at: number; value: Promise<Set<string>> } | null = null;

/**
 * Plugins active on the main site: the ones whose `{ network: true }` handlers
 * run on every site. Read on every request, so cached briefly. A failed read
 * yields an empty set: network handlers then skip that request.
 */
export function activeMainSitePluginIds(): Promise<Set<string>> {
  const now = Date.now();
  if (mainSitePlugins && now - mainSitePlugins.at < MAIN_SITE_PLUGINS_TTL_MS) return mainSitePlugins.value;
  const value = (async () => {
    try {
      const rootId = await installationRootSiteId();
      if (!rootId) return new Set<string>();
      const control = await getControlDb();
      const rows = await control.query<{ plugin_id: string }>(
        "SELECT plugin_id FROM plugins WHERE site_id = ? AND status = 'active'",
        [rootId],
      );
      return new Set(rows.map((row) => String(row.plugin_id)));
    } catch {
      return new Set<string>();
    }
  })();
  mainSitePlugins = { at: now, value };
  return value;
}

/** Drop the cached main-site plugin list after the main site activates or deactivates one. */
export function clearMainSitePluginCache(): void {
  mainSitePlugins = null;
}
