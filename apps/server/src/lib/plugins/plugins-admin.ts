// SPDX-License-Identifier: MIT

import { activatePlugin, deactivatePlugin, getPlugin, markPluginError, pluginToDto } from "./plugins-db.js";
import { auditLog } from "../security/audit-log.js";

/**
 * Shared plugin activation / deactivation behind both `routes/plugins.ts`
 * (cookie auth) and the federated management API. Runtime activation runs
 * first so a plugin whose `activate()` throws is reported as a real failure
 * rather than left half-registered.
 */

export interface PluginAdminActor {
  siteId: string;
  userId: string;
  role: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface PluginAdminResult {
  status: number;
  body: unknown;
}

export async function activatePluginAdmin(
  pluginId: string,
  actor: PluginAdminActor,
): Promise<PluginAdminResult> {
  const { runtimeActivatePlugin } = await import("./plugin-runtime.js");
  try {
    await runtimeActivatePlugin(actor.siteId, pluginId);
  } catch (err) {
    await markPluginError(actor.siteId, pluginId).catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    return { status: 502, body: { error: `Activation failed: ${message}` } };
  }
  await activatePlugin(actor.siteId, pluginId);
  void auditLog({
    siteId: actor.siteId,
    action: "plugin.activated",
    actorId: actor.userId,
    actorRole: actor.role,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
    target: pluginId,
  });
  const { revalidateOnUpdate } = await import("../cache/cache-revalidate.js");
  await revalidateOnUpdate("plugin");
  const { clearPluginAdminAppCache } = await import("./plugin-admin-app.js");
  const { clearPluginAssetsCache } = await import("./plugin-assets.js");
  clearPluginAdminAppCache();
  clearPluginAssetsCache();
  const row = await getPlugin(actor.siteId, pluginId);
  const setupPath = row ? pluginToDto(row).setupPath : undefined;
  return { status: 200, body: { ok: true, ...(setupPath ? { setupPath } : {}) } };
}

/**
 * Another site cannot uninstall a plugin. When its delete-on-uninstall
 * settings are on, turning the plugin off here removes that site's rows and
 * owned CMS types. Tables stay for every other site.
 */
async function purgeSubsitedPluginData(
  siteId: string,
  pluginId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    shouldPurgePluginData,
    shouldPurgePluginContent,
    purgePluginContent,
    purgePluginStorage,
  } = await import("./plugin-purge.js");
  const shouldPurge = await shouldPurgePluginData(siteId, pluginId);
  const shouldPurgeContent = await shouldPurgePluginContent(siteId, pluginId);
  if (!shouldPurge && !shouldPurgeContent) return { ok: true };

  const row = await getPlugin(siteId, pluginId);
  const { runtimeDeletePluginData } = await import("./plugin-runtime.js");
  let hookError: string | undefined;
  try {
    await runtimeDeletePluginData(siteId, pluginId);
  } catch (err) {
    const { sanitizeProbeError } = await import("../database/db-probe.js");
    hookError = sanitizeProbeError(err);
  }

  if (shouldPurgeContent) {
    const purgedContent = await purgePluginContent(siteId, pluginId, row?.manifest);
    if (!purgedContent.ok) {
      return {
        ok: false,
        error: purgedContent.error ?? hookError ?? "Plugin pages and posts could not be deleted",
      };
    }
  }

  if (shouldPurge) {
    const purged = await purgePluginStorage(siteId, pluginId);
    if (!purged.ok) {
      return { ok: false, error: purged.error ?? hookError ?? "Plugin data could not be deleted" };
    }
  }

  return { ok: true };
}

export async function deactivatePluginAdmin(
  pluginId: string,
  actor: PluginAdminActor,
): Promise<PluginAdminResult> {
  const { runtimeDeactivatePlugin } = await import("./plugin-runtime.js");
  const { isInstallationRootSite } = await import("../tenancy/registry.js");
  const { otherSitesHaveActivePlugin } = await import("./plugin-multisite.js");
  const root = await isInstallationRootSite(actor.siteId);
  // The loaded module is shared by every site. Another site turning the plugin
  // off only changes its own row. Unload it when the main site turns it off
  // and no other site still has it on.
  if (root) {
    const others = await otherSitesHaveActivePlugin(pluginId, actor.siteId);
    if (!others) await runtimeDeactivatePlugin(actor.siteId, pluginId);
  } else {
    const purged = await purgeSubsitedPluginData(actor.siteId, pluginId);
    if (!purged.ok) return { status: 500, body: { error: purged.error } };
  }
  await deactivatePlugin(actor.siteId, pluginId);
  // Sub-site deactivation does not fire plugin.deactivated (the module stays
  // loaded for the main site), so clear admin memos here every time.
  const { clearPluginAdminAppCache } = await import("./plugin-admin-app.js");
  const { clearPluginAssetsCache } = await import("./plugin-assets.js");
  clearPluginAdminAppCache();
  clearPluginAssetsCache();
  void auditLog({
    siteId: actor.siteId,
    action: "plugin.deactivated",
    actorId: actor.userId,
    actorRole: actor.role,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
    target: pluginId,
  });
  const { revalidateOnUpdate } = await import("../cache/cache-revalidate.js");
  await revalidateOnUpdate("plugin");
  return { status: 200, body: { ok: true } };
}
