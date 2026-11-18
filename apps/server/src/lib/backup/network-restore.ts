// SPDX-License-Identifier: MIT

import { getControlDb, getDb } from "../database/db.js";
import { getUploadStore } from "../media/upload-store.js";
import { isValidHostname, normalizeHostname } from "../tenancy/host.js";
import { multisiteEnabled } from "../tenancy/multisite.js";
import { createAdditionalSite } from "../tenancy/provision.js";
import type { NetworkBackupReader, NetworkSiteEntry } from "./network-archive.js";
import { restoreSiteBackup } from "./site-restore.js";
import { withBackupSiteDatabase, workspaceSubsites } from "./workspace-backup.js";

export interface NetworkSiteSummary {
  siteId: string;
  siteName: string;
  root: boolean;
  hostnames: Array<{ hostname: string; primary: boolean }>;
  /** Hostname suggested for the restored site: its primary hostname in the source network. */
  suggestedHostname: string | null;
  tables: Record<string, number>;
  records: number;
  mediaFiles: number;
  mediaBytes: number;
}

export interface NetworkBackupSummary {
  createdAt: string;
  source: NetworkBackupReader["manifest"]["source"];
  sites: NetworkSiteSummary[];
  extensions: NetworkBackupReader["manifest"]["extensions"];
}

export interface NetworkRestoreTargetState {
  /** True when the target workspace holds only its root site. */
  clean: boolean;
  existingSubsites: number;
  multisite: boolean;
  /** Plugin ids in the archive that are not installed on the target root site. */
  missingPlugins: string[];
  /** Theme ids in the archive that are not installed on the target root site. */
  missingThemes: string[];
}

export interface NetworkRestoreResult {
  rootSiteId: string;
  sites: Array<{ sourceSiteId: string; siteId: string; siteName: string; hostname: string | null }>;
}

type Progress = (completed: number, total: number, message: string) => void;

/**
 * Decode every site archive once, in order, and report the hierarchy with
 * per-site record and media counts. Any damaged site fails the whole check.
 */
export function summarizeNetworkBackup(reader: NetworkBackupReader, signal?: AbortSignal): NetworkBackupSummary {
  const sites: NetworkSiteSummary[] = [];
  for (const entry of reader.manifest.sites) {
    if (signal?.aborted) throw new Error("Restore cancelled");
    const envelope = reader.readSite(entry);
    const tables = Object.fromEntries(
      Object.entries(envelope.data.tables).map(([name, rows]) => [name, rows.length]),
    );
    sites.push({
      siteId: entry.siteId,
      siteName: entry.siteName,
      root: entry.root,
      hostnames: entry.hostnames,
      suggestedHostname:
        entry.hostnames.find((host) => host.primary)?.hostname ?? entry.hostnames[0]?.hostname ?? null,
      tables,
      records: Object.values(tables).reduce((sum, count) => sum + count, 0),
      mediaFiles: envelope.data.files.length,
      mediaBytes: envelope.data.files.reduce((sum, file) => sum + file.size, 0),
    });
  }
  return {
    createdAt: reader.manifest.createdAt,
    source: reader.manifest.source,
    sites,
    extensions: reader.manifest.extensions,
  };
}

/** What the target installation looks like for this archive, without changing it. */
export async function networkRestoreTargetState(
  rootSiteId: string,
  reader: NetworkBackupReader,
): Promise<NetworkRestoreTargetState> {
  const subsites = await workspaceSubsites(rootSiteId);
  const installed = await withBackupSiteDatabase(rootSiteId, async () => {
    const db = await getDb();
    const [plugins, themes] = await Promise.all([
      db.query<{ plugin_id: string }>("SELECT plugin_id FROM plugins WHERE site_id = ?", [rootSiteId]),
      db.query<{ theme_id: string }>("SELECT theme_id FROM themes WHERE site_id = ?", [rootSiteId]),
    ]);
    return {
      plugins: new Set(plugins.map((row) => String(row.plugin_id))),
      themes: new Set(themes.map((row) => String(row.theme_id))),
    };
  });
  const missing = (items: Array<{ id: string }>, present: Set<string>) =>
    [...new Set(items.map((item) => item.id))].filter((id) => !present.has(id)).sort();
  return {
    clean: subsites.length === 0,
    existingSubsites: subsites.length,
    multisite: multisiteEnabled(),
    missingPlugins: missing(reader.manifest.extensions.plugins, installed.plugins),
    missingThemes: missing(reader.manifest.extensions.themes, installed.themes),
  };
}

/**
 * Check the operator's hostname for every subsite before anything changes:
 * present, valid, unique within the request, and not already routed.
 */
export async function validateNetworkHostnames(
  entries: NetworkSiteEntry[],
  requested: Record<string, unknown>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const entry of entries) {
    if (entry.root) continue;
    const raw = requested[entry.siteId];
    const hostname = typeof raw === "string" ? normalizeHostname(raw) : "";
    if (!hostname || !isValidHostname(hostname)) {
      throw new Error(`Enter a valid hostname for ${entry.siteName}`);
    }
    if (used.has(hostname)) throw new Error(`The hostname ${hostname} is used for more than one site`);
    used.add(hostname);
    result.set(entry.siteId, hostname);
  }
  if (used.size > 0) {
    const control = await getControlDb();
    const hosts = [...used];
    const taken = await control.query<{ hostname: string }>(
      `SELECT hostname FROM site_domains WHERE hostname IN (${hosts.map(() => "?").join(", ")})`,
      hosts,
    );
    if (taken[0]) throw new Error(`The hostname ${String(taken[0].hostname)} is already in use on this installation`);
  }
  return result;
}

/** Remove a subsite this restore created, from its own database and from routing. */
async function discardCreatedSite(siteId: string): Promise<boolean> {
  let complete = true;
  await withBackupSiteDatabase(siteId, async () => {
    await (await getDb()).run("DELETE FROM sites WHERE id = ?", [siteId]);
  }).catch(() => {
    complete = false;
  });
  const control = await getControlDb();
  for (const [sql, params] of [
    ["DELETE FROM quota_limits WHERE scope = 'site' AND scope_id = ?", [siteId]],
    ["DELETE FROM sites WHERE id = ?", [siteId]],
  ] as const) {
    await control.run(sql, [...params]).catch(() => {
      complete = false;
    });
  }
  await getUploadStore()
    .deletePrefix(`${siteId}/`)
    .catch(() => {
      complete = false;
    });
  return complete;
}

/**
 * Recreate the archive's subsites on a clean installation and restore every
 * site. Subsites stay inactive until the root site has been restored; if any
 * step fails or the job is cancelled first, the created subsites are removed
 * so no part of the restored network is ever served. The root site's own
 * restore is transactional and rolls itself back.
 */
export async function restoreNetworkBackup(input: {
  rootSiteId: string;
  actorId: string;
  reader: NetworkBackupReader;
  hostnames: Record<string, unknown>;
  signal?: AbortSignal;
  progress?: Progress;
}): Promise<NetworkRestoreResult> {
  const { rootSiteId, reader, signal } = input;
  const entries = reader.manifest.sites;
  const subsiteEntries = entries.filter((entry) => !entry.root);
  const rootEntry = entries[0];
  if (!rootEntry?.root) throw new Error("Network backup has no root site");
  const control = await getControlDb();
  const tenants = await control.query<{ tenant_id: string }>(
    "SELECT tenant_id FROM sites WHERE id = ? LIMIT 1",
    [rootSiteId],
  );
  const tenantId = tenants[0]?.tenant_id ? String(tenants[0].tenant_id) : "";
  if (!tenantId) throw new Error("Installation root site not found");
  if (subsiteEntries.length > 0 && !multisiteEnabled()) {
    throw new Error("Turn on multisite (JF_MULTISITE=true) before restoring a network with subsites");
  }
  const existing = await workspaceSubsites(rootSiteId);
  if (existing.length > 0) {
    throw new Error(
      `Network restore needs a clean installation, but this workspace already has ${existing.length} subsite${existing.length === 1 ? "" : "s"}`,
    );
  }
  const hostnames = await validateNetworkHostnames(entries, input.hostnames);

  const total = entries.length * 2 + 1;
  let step = 0;
  const report = (message: string) => input.progress?.(++step, total, message);
  for (const entry of entries) {
    if (signal?.aborted) throw new Error("Restore cancelled");
    reader.readSite(entry);
    report(`Checked ${entry.siteName}`);
  }

  const created: Array<{ entry: NetworkSiteEntry; siteId: string; hostname: string }> = [];
  const discardAll = async (cause: unknown): Promise<never> => {
    const leftovers = await control
      .query<{ site_id: string }>(
        hostnames.size > 0
          ? `SELECT site_id FROM site_domains WHERE hostname IN (${[...hostnames.values()].map(() => "?").join(", ")})`
          : "SELECT site_id FROM site_domains WHERE 1 = 0",
        [...hostnames.values()],
      )
      .catch(() => [] as Array<{ site_id: string }>);
    const ids = new Set([...created.map((site) => site.siteId), ...leftovers.map((row) => String(row.site_id))]);
    ids.delete(rootSiteId);
    let complete = true;
    for (const siteId of ids) if (!(await discardCreatedSite(siteId))) complete = false;
    const reason = cause instanceof Error ? cause.message : "Network restore failed";
    throw new Error(
      complete
        ? `${reason}. No subsites were kept and the root site was not changed.`
        : `${reason}. Some created subsites could not be removed; they stay inactive. Delete them under Platform before retrying.`,
      { cause },
    );
  };

  try {
    for (const entry of subsiteEntries) {
      if (signal?.aborted) throw new Error("Restore cancelled");
      const hostname = hostnames.get(entry.siteId);
      if (!hostname) throw new Error(`No hostname for ${entry.siteName}`);
      const site = await createAdditionalSite({
        tenantId,
        name: entry.siteName,
        hostname,
        databaseChoice: "inherit",
        adminFrom: { siteId: rootSiteId, userId: input.actorId },
        actorId: input.actorId,
      });
      if (!site.ok) throw new Error(`${entry.siteName}: ${site.error}`);
      created.push({ entry, siteId: site.siteId, hostname });
      await control.run("UPDATE sites SET status = 'provisioning', active = ? WHERE id = ?", [false, site.siteId]);
      const envelope = reader.readSite(entry);
      await withBackupSiteDatabase(site.siteId, async () => restoreSiteBackup(await getDb(), site.siteId, envelope));
      report(`Restored ${entry.siteName}`);
    }
    if (signal?.aborted) throw new Error("Restore cancelled");
    const rootEnvelope = reader.readSite(rootEntry);
    await withBackupSiteDatabase(rootSiteId, async () => restoreSiteBackup(await getDb(), rootSiteId, rootEnvelope));
    report(`Restored ${rootEntry.siteName}`);
  } catch (error) {
    return discardAll(error);
  }

  for (const site of created) {
    await control.run("UPDATE sites SET status = 'active', active = ? WHERE id = ?", [true, site.siteId]);
  }
  report("Network restored");
  return {
    rootSiteId,
    sites: [
      { sourceSiteId: rootEntry.siteId, siteId: rootSiteId, siteName: rootEntry.siteName, hostname: null },
      ...created.map((site) => ({
        sourceSiteId: site.entry.siteId,
        siteId: site.siteId,
        siteName: site.entry.siteName,
        hostname: site.hostname,
      })),
    ],
  };
}
