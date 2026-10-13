// SPDX-License-Identifier: MIT

import { JobScheduler } from "@justflows/jobs";
import type { PluginJobContext, PluginJobDefinition, PluginJobsApi } from "@justflows/sdk";
import { getControlDb, getDb } from "../database/db.js";
import { eachActiveSite } from "../tenancy/connections.js";
import { DurableJobQueue } from "../jobs/job-queue.js";
import { getTenantContext, runWithTenant, type TenantRequestContext } from "../tenancy/context.js";
import { installationRootSiteId } from "../tenancy/registry.js";

let scheduler: JobScheduler | null = null;
let queue: DurableJobQueue | null = null;

/** The durable queue for `ctx.jobs.enqueue` runs, in the control database (`job_queue`). */
export function getDurableJobQueue(): DurableJobQueue {
  if (!queue) {
    queue = new DurableJobQueue({
      db: () => getControlDb(),
      logger: {
        info: (msg, ctx) => console.info(msg, ctx ?? ""),
        warn: (msg, ctx) => console.warn(msg, ctx ?? ""),
        error: (msg, ctx) => console.error(msg, ctx ?? ""),
      },
    });
    queue.start();
  }
  return queue;
}

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

/**
 * Run `handler` once per site where the plugin is active, or only on `onlySiteId`.
 * Reports every site that failed.
 */
export async function runPerSite(
  pluginId: string,
  handler: (siteId: string) => Promise<{ success: boolean; message?: string }>,
  onlySiteId?: string,
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
  }, onlySiteId ? { siteId: onlySiteId } : {});
  return failed.length === 0 ? { success: true } : { success: false, message: failed.join("; ").slice(0, 500) };
}

export function createPluginJobsApi(pluginId: string): PluginJobsApi {
  const jobs = getPluginJobScheduler();
  const durable = getDurableJobQueue();
  const perSite = new Map<string, boolean>();
  return {
    register(def: PluginJobDefinition) {
      const fullName = `${pluginId}:${def.name}`;
      // Enqueued runs go through the durable queue. A per-site run is for the
      // site that enqueued it, or for every site when it was enqueued outside one.
      durable.register(fullName, {
        maxAttempts: def.maxAttempts ?? 3,
        run: (row) => {
          const base: PluginJobContext = {
            jobId: row.id,
            name: def.name,
            attempt: row.attempts,
            scheduledAt: row.runAt,
            payload: row.payload,
          };
          if (!def.perSite) return def.handler(base);
          return runPerSite(pluginId, (siteId) => def.handler({ ...base, siteId }), row.siteId ?? undefined);
        },
      });
      perSite.set(def.name, Boolean(def.perSite));
      jobs.register({
        name: fullName,
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
      const fullName = `${pluginId}:${name}`;
      if (!durable.has(fullName)) throw new Error(`Job "${fullName}" not found`);
      const siteId = perSite.get(name) ? (getTenantContext()?.siteId ?? null) : null;
      // Falls back to the in-memory scheduler before migration 0048 or when the
      // row cannot be written; that run does not survive a restart.
      return (async () => {
        try {
          if (await durable.isAvailable()) {
            await durable.enqueue(fullName, { delayMs: options?.delayMs ?? 0, payload: options?.payload, siteId });
            return;
          }
        } catch (err) {
          console.error(`[jobs] Could not store "${fullName}"; running it in memory`, String(err));
        }
        try {
          jobs.enqueue(fullName, options?.delayMs ?? 0, options?.payload);
        } catch (err) {
          console.error(`[jobs] Could not enqueue "${fullName}"`, String(err));
        }
      })();
    },
  };
}
