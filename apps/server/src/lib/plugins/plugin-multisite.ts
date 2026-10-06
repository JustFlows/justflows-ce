// SPDX-License-Identifier: MIT

import type { PluginDto } from "./plugins-db.js";
import { getPlugin, insertPlugin, listPlugins, pluginToDto, type PluginRow } from "./plugins-db.js";
import { getControlDb, getDb } from "../database/db.js";
import { installationRootSiteId } from "../tenancy/registry.js";
import {
  PLUGIN_HOST_COLLECTION,
  PLUGIN_HOST_MULTISITE_ITEM,
  setPluginHostItem,
} from "./plugin-kv.js";

export function manifestAllowsMultisite(manifest: Record<string, unknown> | null | undefined): boolean {
  return manifest?.allowMultisite === true;
}

/**
 * Tables are dropped only on the main site, and only when no other site still
 * has the plugin. Every other removal deletes that site's rows.
 */
export function mayDropPluginTables(input: {
  installationRoot: boolean;
  otherSitesUsePlugin: boolean;
}): boolean {
  return input.installationRoot && !input.otherSitesUsePlugin;
}

function asManifest(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asManifest(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseRow(row: PluginRow): PluginRow {
  return {
    ...row,
    manifest: asManifest(row.manifest),
    approved_permissions: Array.isArray(row.approved_permissions) ? row.approved_permissions : [],
  };
}

export async function otherSitesHavePlugin(pluginId: string, siteId: string): Promise<boolean> {
  try {
    const db = await getDb();
    const rows = await db.query<{ site_id: string }>(
      "SELECT site_id FROM plugins WHERE plugin_id = ? AND site_id <> ? LIMIT 1",
      [pluginId, siteId],
    );
    return Boolean(rows[0]);
  } catch {
    return false;
  }
}

export async function isPluginOfferedToOtherSites(pluginId: string, rootSiteId: string): Promise<boolean> {
  try {
    const db = await getControlDb();
    const rows = await db.query<{ payload: unknown }>(
      "SELECT payload FROM plugin_data WHERE site_id = ? AND plugin_id = ? AND collection = ? AND item_id = ? LIMIT 1",
      [rootSiteId, pluginId, PLUGIN_HOST_COLLECTION, PLUGIN_HOST_MULTISITE_ITEM],
    );
    return asManifest(rows[0]?.payload).enabled === true;
  } catch {
    return false;
  }
}

export async function setPluginOfferedToOtherSites(
  pluginId: string,
  rootSiteId: string,
  enabled: boolean,
): Promise<void> {
  await setPluginHostItem(pluginId, rootSiteId, PLUGIN_HOST_MULTISITE_ITEM, { enabled });
}

/** Plugins this site may see. The main site sees what it installed. Another site sees plugins the main site has offered. */
export async function listVisiblePlugins(siteId: string): Promise<PluginDto[]> {
  const rootId = await installationRootSiteId();
  if (!rootId || rootId === siteId) {
    const plugins = await listPlugins(siteId);
    const offered = await Promise.all(
      plugins.map(async (plugin) =>
        plugin.allowMultisite ? isPluginOfferedToOtherSites(plugin.id, siteId) : Promise.resolve(false),
      ),
    );
    return plugins.map((plugin, index) => ({ ...plugin, multisiteEnabled: offered[index] === true }));
  }

  const control = await getControlDb();
  let rootRows: PluginRow[] = [];
  try {
    rootRows = await control.query<PluginRow>(
      "SELECT * FROM plugins WHERE site_id = ? ORDER BY installed_at DESC",
      [rootId],
    );
  } catch {
    rootRows = [];
  }

  const offeredIds = new Set<string>();
  const visible: PluginDto[] = [];
  for (const raw of rootRows) {
    const row = parseRow(raw);
    if (!manifestAllowsMultisite(row.manifest)) continue;
    if (!(await isPluginOfferedToOtherSites(row.plugin_id, rootId))) continue;
    offeredIds.add(row.plugin_id);
    const local = await getPlugin(siteId, row.plugin_id);
    const dto = pluginToDto(
      local ?? {
        ...row,
        site_id: siteId,
        status: "inactive",
        activated_at: null,
      },
    );
    visible.push({ ...dto, allowMultisite: true, multisiteEnabled: true });
  }

  try {
    const db = await getDb();
    const localRows = await db.query<PluginRow>("SELECT * FROM plugins WHERE site_id = ?", [siteId]);
    for (const raw of localRows) {
      const row = parseRow(raw);
      if (offeredIds.has(row.plugin_id)) continue;
      visible.push(pluginToDto(row));
    }
  } catch {
    // This site has no plugin rows yet.
  }
  return visible;
}

/**
 * A site other than the main site can activate a plugin only after the main
 * site has installed it and turned on “Available on other sites”.
 */
export async function prepareSubsitedActivation(
  siteId: string,
  pluginId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await getPlugin(siteId, pluginId)) return { ok: true };
  const rootId = await installationRootSiteId();
  if (!rootId || rootId === siteId) {
    return { ok: false, error: "Plugin is not installed on this site." };
  }
  const control = await getControlDb();
  const rows = await control.query<PluginRow>(
    "SELECT * FROM plugins WHERE site_id = ? AND plugin_id = ? LIMIT 1",
    [rootId, pluginId],
  );
  const rootPlugin = rows[0] ? parseRow(rows[0]) : null;
  if (!rootPlugin || !manifestAllowsMultisite(rootPlugin.manifest)) {
    return { ok: false, error: "This plugin is not available on this site." };
  }
  if (!(await isPluginOfferedToOtherSites(pluginId, rootId))) {
    return { ok: false, error: "The main site has not made this plugin available to other sites." };
  }
  await insertPlugin(siteId, {
    pluginId: rootPlugin.plugin_id,
    version: rootPlugin.version,
    manifest: rootPlugin.manifest,
    status: "inactive",
  });
  return { ok: true };
}
