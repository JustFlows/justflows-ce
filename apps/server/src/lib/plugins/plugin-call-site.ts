// SPDX-License-Identifier: MIT

import type { PluginHttpResponse } from "@justflows/sdk";
import { getControlDb, getDb } from "../database/db.js";
import { getTenantContext, runWithTenant, type TenantRequestContext } from "../tenancy/context.js";
import { installationRootSiteId } from "../tenancy/registry.js";
import { runWithSiteDatabase } from "../tenancy/provision.js";

/** A plugin call may read another site only when both belong to the active workspace. */
export function siblingCallAllowed(
  currentTenantId: string,
  site: { tenantId: string; status: string; tenantStatus: string } | null,
): boolean {
  return (
    currentTenantId.length > 0 &&
    site !== null &&
    site.tenantId === currentTenantId &&
    site.status === "active" &&
    site.tenantStatus === "active"
  );
}

function refused(): PluginHttpResponse {
  return { status: 403, body: { error: { code: "forbidden", message: "That site is not in this workspace." } } };
}

/**
 * Run `fn` with plugin row calls bound to `siteId`. The same site keeps the
 * request as it is. Another site must be active in the same workspace.
 */
export async function runPluginCallForSite(
  siteId: string,
  fn: () => Promise<PluginHttpResponse>,
): Promise<PluginHttpResponse> {
  const current = getTenantContext();
  if (!current?.tenantId) return refused();
  if (siteId === current.siteId) return fn();

  const control = await getControlDb();
  const rows = await control.query<{
    id: string;
    tenant_id: string;
    status: string;
    tenant_status: string;
    name: string;
    hostname: string | null;
    user_mode: string;
    database_mode: string;
  }>(
    `SELECT s.id, s.tenant_id, s.status, s.name, t.status AS tenant_status, t.user_mode, t.database_mode, d.hostname
     FROM sites s
     JOIN tenants t ON t.id = s.tenant_id
     LEFT JOIN site_domains d ON d.site_id = s.id AND d.is_primary = ?
     WHERE s.id = ?
     LIMIT 1`,
    [true, siteId],
  );
  const row = rows[0];
  const site = row
    ? {
        tenantId: String(row.tenant_id),
        status: String(row.status),
        tenantStatus: String(row.tenant_status),
      }
    : null;
  if (!siblingCallAllowed(current.tenantId, site) || !row) return refused();

  const root = await installationRootSiteId(control).catch(() => null);
  const context: TenantRequestContext = {
    tenantId: current.tenantId,
    siteId,
    hostname: row.hostname ? String(row.hostname) : String(row.name),
    userMode: row.user_mode === "shared" ? "shared" : "isolated",
    databaseMode: row.database_mode === "separate" ? "separate" : "current",
    rootSite: root === null || root === siteId,
    activePluginIds: null,
  };

  return runWithSiteDatabase(siteId, async () => {
    try {
      const plugins = await (await getDb()).query<{ plugin_id: string }>(
        "SELECT plugin_id FROM plugins WHERE site_id = ? AND status = 'active'",
        [siteId],
      );
      context.activePluginIds = new Set(plugins.map((plugin) => String(plugin.plugin_id)));
    } catch {
      context.activePluginIds = null;
    }
    return runWithTenant(context, fn);
  });
}
