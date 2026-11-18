// SPDX-License-Identifier: MIT

import { getControlDb, getDb, runWithDatabase } from "../database/db.js";
import { effectiveDatabaseMode } from "../tenancy/choice.js";
import { borrowSeparateDatabase, separateDatabaseForSite } from "../tenancy/connections.js";
import { exportSiteData, type SiteExport } from "./site-export.js";
import { createPortableBackup } from "./portable-archive.js";
import { createBackupContainer, type ContainerSiteInput, type InstallationSnapshot } from "./backup-container.js";
import { sealBackup, type BackupKind } from "./archive-crypto.js";
import { decodeJsonColumns, exportSecrets, exportValue, selectColumns, tableColumns } from "./site-tables.js";
import type { RetainedPackageMeta } from "./package-archives.js";

const MAX_SUBSITES_PER_BACKUP = 100;

export interface BackupArtifact {
  siteId: string;
  siteName: string;
  /** The encrypted backup file. */
  archive: Buffer;
  filename: string;
}

export interface BuildOptions {
  passphrase: string;
  createdAt: string;
  databaseDriver: "postgres" | "mysql" | "mariadb";
  coreVersion: string | undefined;
  signal?: AbortSignal;
  progress?: (completed: number, total: number) => void;
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

/** The live subsites of the root site's workspace, oldest first, bounded per job. */
export async function workspaceSubsites(rootSiteId: string): Promise<Array<{ id: string; name: string }>> {
  const control = await getControlDb();
  const roots = await control.query<{ tenant_id: string }>("SELECT tenant_id FROM sites WHERE id = ? LIMIT 1", [rootSiteId]);
  const tenantId = roots[0]?.tenant_id;
  if (!tenantId) throw new Error("Installation root site not found");
  const sites = await control.query<{ id: string; name: string }>(
    `SELECT id, name FROM sites
     WHERE tenant_id = ? AND id <> ? AND status <> 'deleted'
     ORDER BY created_at ASC, id ASC LIMIT ${MAX_SUBSITES_PER_BACKUP + 1}`,
    [tenantId, rootSiteId],
  );
  if (sites.length > MAX_SUBSITES_PER_BACKUP) throw new Error("Subsite backup is limited to 100 sites per job");
  return sites.map((site) => ({ id: String(site.id), name: String(site.name) }));
}

/** Export one site through its own database. */
export async function exportSite(siteId: string, options: { installationRoot: boolean; signal?: AbortSignal }): Promise<SiteExport> {
  return withBackupSiteDatabase(siteId, async () => exportSiteData(await getDb(), siteId, options));
}

function containerSite(exported: SiteExport, input: BuildOptions, root: boolean): ContainerSiteInput {
  const site = exported.data.site;
  const siteId = String(site.id);
  const siteName = String(site.name ?? "Justflows site");
  return {
    siteId,
    siteName,
    root,
    hostnames: exported.hostnames,
    extensions: exported.data.extensions,
    archive: createPortableBackup({
      createdAt: input.createdAt,
      source: { siteId, siteName, databaseDriver: input.databaseDriver, coreVersion: input.coreVersion },
      data: exported.data,
    }),
  };
}

function seal(kind: BackupKind, input: BuildOptions, sites: ContainerSiteInput[], packages: Array<{ meta: RetainedPackageMeta; buffer: Buffer }>, installation: InstallationSnapshot | null): Buffer {
  const container = createBackupContainer({
    kind,
    createdAt: input.createdAt,
    databaseDriver: input.databaseDriver,
    coreVersion: input.coreVersion,
    installation,
    sites,
    packages,
  });
  return sealBackup(container, input.passphrase, { kind, createdAt: input.createdAt, siteName: sites[0]?.siteName ?? "" });
}

async function isInstallationRoot(siteId: string): Promise<boolean> {
  const { isInstallationRootSite } = await import("../tenancy/registry.js");
  return isInstallationRootSite(siteId);
}

/** One encrypted file holding a complete snapshot of one site. */
export async function buildSiteBackup(siteId: string, input: BuildOptions, prefix = "site"): Promise<BackupArtifact> {
  const exported = await exportSite(siteId, { installationRoot: await isInstallationRoot(siteId), signal: input.signal });
  if (input.signal?.aborted) throw new Error("Backup cancelled");
  const site = containerSite(exported, input, false);
  return {
    siteId,
    siteName: site.siteName,
    archive: seal("site", input, [site], exported.packages, null),
    filename: `justflows-${prefix}-${filenamePart(site.siteName)}-${input.createdAt.slice(0, 10)}.jfbackup`,
  };
}

/** One independent encrypted file for each subsite in the root workspace. */
export async function buildSubsiteBackups(rootSiteId: string, input: BuildOptions): Promise<BackupArtifact[]> {
  const sites = await workspaceSubsites(rootSiteId);
  if (sites.length === 0) throw new Error("This workspace has no subsites to back up");
  const artifacts: BackupArtifact[] = [];
  let totalBytes = 0;
  for (const [index, site] of sites.entries()) {
    if (input.signal?.aborted) throw new Error("Backup cancelled");
    const artifact = await buildSiteBackup(site.id, { ...input, progress: undefined }, "subsite");
    totalBytes += artifact.archive.byteLength;
    if (totalBytes > 512 * 1024 * 1024) throw new Error("Combined subsite backups exceed the 512 MB job limit");
    artifacts.push(artifact);
    input.progress?.(index + 1, sites.length);
  }
  return artifacts;
}

/** Workspace and installation settings of the root, with secrets made portable. */
async function installationSnapshot(rootSiteId: string): Promise<InstallationSnapshot> {
  const control = await getControlDb();
  const tenant = (
    await control.query<{ name: string; slug: string; user_mode: string }>(
      "SELECT t.name, t.slug, t.user_mode FROM tenants t JOIN sites s ON s.tenant_id = t.id WHERE s.id = ? LIMIT 1",
      [rootSiteId],
    )
  )[0];
  const engine = process.env.DB_DRIVER === "mysql" || process.env.DB_DRIVER === "mariadb" ? process.env.DB_DRIVER : "postgres";
  const settingColumns = (await tableColumns(control, "platform_settings", engine)) ?? [];
  const settings = settingColumns.length
    ? decodeJsonColumns(await control.query<Record<string, unknown>>(`SELECT ${selectColumns(settingColumns, engine)} FROM platform_settings x`, []), settingColumns)
    : [];
  const operators = await control.query<{ user_id: string }>("SELECT user_id FROM platform_operators", []);
  const stats = { undecryptable: 0 };
  return {
    tenant: { name: String(tenant?.name ?? ""), slug: String(tenant?.slug ?? ""), userMode: String(tenant?.user_mode ?? "isolated") },
    platformSettings: settings.map((row) => exportSecrets(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, exportValue(value)])), stats) as Record<string, unknown>),
    platformOperators: operators.map((row) => String(row.user_id)),
  };
}

/**
 * One encrypted file holding the root site, every subsite of its workspace,
 * the installation settings, and each package archive once.
 */
export async function buildNetworkBackup(rootSiteId: string, input: BuildOptions): Promise<BackupArtifact> {
  const subsites = await workspaceSubsites(rootSiteId);
  const total = subsites.length + 1;
  const root = await exportSite(rootSiteId, { installationRoot: true, signal: input.signal });
  input.progress?.(1, total);
  const sites = [containerSite(root, input, true)];
  const packages = [...root.packages];
  for (const [index, site] of subsites.entries()) {
    if (input.signal?.aborted) throw new Error("Backup cancelled");
    const exported = await exportSite(site.id, { installationRoot: false, signal: input.signal });
    sites.push(containerSite(exported, input, false));
    packages.push(...exported.packages);
    input.progress?.(index + 2, total);
  }
  if (input.signal?.aborted) throw new Error("Backup cancelled");
  const rootName = sites[0]!.siteName;
  return {
    siteId: rootSiteId,
    siteName: rootName,
    archive: seal("network", input, sites, packages, await installationSnapshot(rootSiteId)),
    filename: `justflows-network-${filenamePart(rootName)}-${input.createdAt.slice(0, 10)}.jfbackup`,
  };
}

/** Sites in the root workspace that may receive an independently restored archive. */
export async function workspaceRestoreTargets(rootSiteId: string): Promise<Array<{ id: string; name: string; root: boolean }>> {
  const control = await getControlDb();
  return control.query<{ id: string; name: string; root: boolean }>(
    `SELECT id, name, CASE WHEN id = ? THEN true ELSE false END AS root
     FROM sites WHERE tenant_id = (SELECT tenant_id FROM sites WHERE id = ?)
       AND status <> 'deleted' ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, created_at ASC, id ASC`,
    [rootSiteId, rootSiteId, rootSiteId],
  );
}
