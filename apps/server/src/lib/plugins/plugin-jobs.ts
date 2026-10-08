// SPDX-License-Identifier: MIT

import { JobScheduler } from "@justflows/jobs";
import type { PluginJobContext, PluginJobDefinition, PluginJobsApi } from "@justflows/sdk";
import { getControlDb, getDb } from "../database/db.js";
import { eachActiveSite } from "../tenancy/connections.js";
import { runWithTenant, type TenantRequestContext } from "../tenancy/context.js";
import { installationRootSiteId } from "../tenancy/registry.js";

let scheduler: JobScheduler | null = null;

export function getPluginJobScheduler(): JobScheduler {
  if (!scheduler) {
    scheduler = new JobScheduler({
      info: (msg, ctx) => console.info(msg, ctx ?? ""),
      warn: (msg, ctx) => console.warn(msg, ctx ?? ""),
      error: (msg, ctx) => console.error(msg, ctx ?? ""),
    });
    scheduler.start();
  }
  return scheduler;
}

/**
 * The request context a plugin call would have on this site, or null when the
 * plugin is not active there. Runs inside `eachActiveSite`, so `getDb()` is
 * already that site's database.
 */
async function pluginSiteContext(pluginId: string, siteId: string): Promise<TenantRequestContext | null> {
  const db = await getDb();
  const active = await db
    .query<{ plugin_id: string }>("SELECT plugin_id FROM plugins WHERE site_id = ? AND status = 'active'", [siteId])
    .catch(() => null);
  if (!active) return null;
  const activePluginIds = new Set(active.map((row) => String(row.plugin_id)));
  if (!activePluginIds.has(pluginId)) return null;
  const control = await getControlDb();
  const site = (
    await control
      .query<{ tenant_id: string; user_mode: string; database_mode: string }>(
        `SELECT s.tenant_id, t.user_mode, t.database_mode
         FROM sites s JOIN tenants t ON t.id = s.tenant_id
         WHERE s.id = ? LIMIT 1`,
        [siteId],
      )
      .catch(() => [])
  )[0];
  const root = await installationRootSiteId(control).catch(() => null);
  return {
    tenantId: site ? String(site.tenant_id) : "",
    siteId,
    hostname: "",
    userMode: site?.user_mode === "shared" ? "shared" : "isolated",
    databaseMode: site?.database_mode === "separate" ? "separate" : "current",
    rootSite: root === null || root === siteId,
    activePluginIds,
  };
}

/** Run `handler` once per site where the plugin is active. Reports every site that failed. */
export async function runPerSite(
  pluginId: string,
  handler: (siteId: string) => Promise<{ success: boolean; message?: string }>,
): Promise<{ success: boolean; message?: string }> {
  const failed: string[] = [];
  await eachActiveSite(async (siteId) => {
    const context = await pluginSiteContext(pluginId, siteId);
    if (!context) return;
    try {
      const result = await runWithTenant(context, () => handler(siteId));
      if (!result.success) failed.push(`${siteId}: ${result.message ?? "failed"}`);
    } catch (err) {
      failed.push(`${siteId}: ${err instanceof Error ? err.message : "failed"}`);
    }
  });
  return failed.length === 0 ? { success: true } : { success: false, message: failed.join("; ").slice(0, 500) };
}

export function createPluginJobsApi(pluginId: string): PluginJobsApi {
  const jobs = getPluginJobScheduler();
  return {
    register(def: PluginJobDefinition) {
      jobs.register({
        name: `${pluginId}:${def.name}`,
        schedule: def.schedule,
        maxAttempts: def.maxAttempts,
        handler: async (ctx) => {
          const base: PluginJobContext = {
            jobId: ctx.jobId,
            name: def.name,
            attempt: ctx.attempt,
            scheduledAt: ctx.scheduledAt,
            payload: ctx.payload,
          };
          if (!def.perSite) return def.handler(base);
          return runPerSite(pluginId, (siteId) => def.handler({ ...base, siteId }));
        },
      });
    },
    enqueue(name, options) {
      jobs.enqueue(`${pluginId}:${name}`, options?.delayMs ?? 0, options?.payload);
    },
  };
}
