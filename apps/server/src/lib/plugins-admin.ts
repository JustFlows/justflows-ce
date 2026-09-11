// SPDX-License-Identifier: MIT

import { activatePlugin, deactivatePlugin, getPlugin, markPluginError, pluginToDto } from "./plugins-db.js";
import { auditLog } from "./audit-log.js";

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
  const { revalidateOnUpdate } = await import("./cache-revalidate.js");
  await revalidateOnUpdate("plugin");
  const row = await getPlugin(actor.siteId, pluginId);
  const setupPath = row ? pluginToDto(row).setupPath : undefined;
  return { status: 200, body: { ok: true, ...(setupPath ? { setupPath } : {}) } };
}

export async function deactivatePluginAdmin(
  pluginId: string,
  actor: PluginAdminActor,
): Promise<PluginAdminResult> {
  const { runtimeDeactivatePlugin } = await import("./plugin-runtime.js");
  await deactivatePlugin(actor.siteId, pluginId);
  await runtimeDeactivatePlugin(actor.siteId, pluginId).catch(() => null);
  void auditLog({
    siteId: actor.siteId,
    action: "plugin.deactivated",
    actorId: actor.userId,
    actorRole: actor.role,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
    target: pluginId,
  });
  const { revalidateOnUpdate } = await import("./cache-revalidate.js");
  await revalidateOnUpdate("plugin");
  return { status: 200, body: { ok: true } };
}
