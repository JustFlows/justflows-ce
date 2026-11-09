// SPDX-License-Identifier: MIT

import { getControlDb, getDb, runWithDatabase } from "../database/db.js";
import { effectiveDatabaseMode } from "../tenancy/choice.js";
import { borrowSeparateDatabase, separateDatabaseForSite } from "../tenancy/connections.js";
import { exportSiteData } from "./site-export.js";
import { createPortableBackup } from "./portable-archive.js";

const MAX_SUBSITES_PER_BACKUP = 100;
const MAX_SUBSITE_BACKUP_BYTES = 512 * 1024 * 1024;

export interface BackupArtifact {
  siteId: string;
  siteName: string;
  archive: Buffer;
  filename: string;
}

/** Build one portable archive for a selected site in its authoritative database. */
export async function buildSiteBackup(
  siteId: string,
  createdAt: string,
  databaseDriver: "postgres" | "mysql" | "mariadb",
  coreVersion: string | undefined,
  options: { signal?: AbortSignal; progress?: (completed: number, total: number) => void } = {},
): Promise<BackupArtifact> {
  return withBackupSiteDatabase(siteId, async () => {
    const data = await exportSiteData(await getDb(), siteId, options);
    if (options.signal?.aborted) throw new Error("Backup cancelled");
    const site = data.tables.sites?.[0];
    if (!site) throw new Error("Site not found");
    return {
      siteId,
      siteName: String(site.name ?? "Justflows site"),
      archive: createPortableBackup({
        createdAt,
        source: {
          siteId,
          siteName: String(site.name ?? "Justflows site"),
          databaseDriver,
          coreVersion,
        },
        data,
      }),
      filename: `justflows-site-${filenamePart(String(site.name ?? "site"))}-${createdAt.slice(0, 10)}.jfbackup`,
    };
  });
}

/** Run backup or restore work in the selected site's authoritative database without falling back. */
export async function withBackupSiteDatabase<T>(siteId: string, fn: () => Promise<T>): Promise<T> {
  const control = await getControlDb();
  const sites = await control.query<{
    tenant_id: string;
    database_choice: string;
    database_mode: string;
  }>(
    `SELECT s.tenant_id, s.database_choice, t.database_mode
     FROM sites s JOIN tenants t ON t.id = s.tenant_id WHERE s.id = ? LIMIT 1`,
    [siteId],
  );
  const site = sites[0];
  if (!site) throw new Error("Backup site was not found");
  const choice =
    site.database_choice === "current" || site.database_choice === "separate"
      ? site.database_choice
      : "inherit";
  const mode = site.database_mode === "separate" ? "separate" : "current";
  if (effectiveDatabaseMode(mode, choice) === "current") return runWithDatabase(control, fn);
  const row = await separateDatabaseForSite(site.tenant_id, siteId, choice, mode);
  if (!row) throw new Error("The selected site's database is unavailable");
  const client = await borrowSeparateDatabase(row);
  if (!client) throw new Error("The selected site's database is unavailable");
  return runWithDatabase(client, fn);
}

function filenamePart(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "site"
  );
}

/** Build one independent portable archive for each subsite in the root workspace. */
export async function buildSubsiteBackups(
  rootSiteId: string,
  createdAt: string,
  databaseDriver: "postgres" | "mysql" | "mariadb",
  coreVersion: string | undefined,
  options: { signal?: AbortSignal; progress?: (completed: number, total: number) => void } = {},
): Promise<BackupArtifact[]> {
  const control = await getControlDb();
  const roots = await control.query<{ tenant_id: string }>(
    "SELECT tenant_id FROM sites WHERE id = ? LIMIT 1",
    [rootSiteId],
  );
  const tenantId = roots[0]?.tenant_id;
  if (!tenantId) throw new Error("Installation root site not found");
  const sites = await control.query<{ id: string; name: string }>(
    `SELECT id, name FROM sites
     WHERE tenant_id = ? AND id <> ? AND status <> 'deleted'
     ORDER BY created_at ASC, id ASC LIMIT ${MAX_SUBSITES_PER_BACKUP + 1}`,
    [tenantId, rootSiteId],
  );
  if (sites.length === 0) throw new Error("This workspace has no subsites to back up");
  if (sites.length > MAX_SUBSITES_PER_BACKUP)
    throw new Error("Subsite backup is limited to 100 sites per job");
  const artifacts: BackupArtifact[] = [];
  let totalBytes = 0;
  for (const [index, site] of sites.entries()) {
    if (options.signal?.aborted) throw new Error("Backup cancelled");
    const data = await withBackupSiteDatabase(String(site.id), async () =>
      exportSiteData(await getDb(), String(site.id), { signal: options.signal }),
    );
    const archive = createPortableBackup({
      createdAt,
      source: {
        siteId: String(site.id),
        siteName: String(site.name),
        databaseDriver,
        coreVersion,
      },
      data,
    });
    totalBytes += archive.byteLength;
    if (totalBytes > MAX_SUBSITE_BACKUP_BYTES)
      throw new Error("Combined subsite backups exceed the 512 MB job limit");
    artifacts.push({
      siteId: String(site.id),
      siteName: String(site.name),
      archive,
      filename: `justflows-subsite-${filenamePart(String(site.name))}-${createdAt.slice(0, 10)}.jfbackup`,
    });
    options.progress?.(index + 1, sites.length);
  }
  return artifacts;
}

/** Sites in the root workspace that may receive an independently restored archive. */
export async function workspaceRestoreTargets(
  rootSiteId: string,
): Promise<Array<{ id: string; name: string; root: boolean }>> {
  const control = await getControlDb();
  return control.query<{ id: string; name: string; root: boolean }>(
    `SELECT id, name, CASE WHEN id = ? THEN true ELSE false END AS root
     FROM sites WHERE tenant_id = (SELECT tenant_id FROM sites WHERE id = ?)
       AND status <> 'deleted' ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, created_at ASC, id ASC`,
    [rootSiteId, rootSiteId, rootSiteId],
  );
}
