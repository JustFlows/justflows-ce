// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import { getControlDb, getDb } from "../database/db.js";
import { getUploadStore } from "../media/upload-store.js";
import { isValidHostname, normalizeHostname, siteDomainKind } from "../tenancy/host.js";
import { multisiteEnabled } from "../tenancy/multisite.js";
import { validateDatabaseTarget, type DatabaseTarget } from "../tenancy/choice.js";
import type { BackupReader, ContainerSiteEntry } from "./backup-container.js";
import {
  PORTABLE_BACKUP_FORMAT,
  PORTABLE_BACKUP_VERSION,
  type PortableBackupEnvelope,
  type PortableDatabaseConnection,
} from "./portable-archive.js";
import { exportSiteData } from "./site-export.js";
import { restoreSiteBackup, stopPluginsAfterRollback, type PluginDatabaseChoice } from "./site-restore.js";
import { decodeJsonColumns, IdMap, importSecrets, insertRows, selectColumns, tableColumns, type BackupDriver } from "./site-tables.js";
import { withBackupSiteDatabase, workspaceSubsites } from "./workspace-backup.js";

type Row = Record<string, unknown>;
type Progress = (completed: number, total: number, message: string) => void;

/** The operator's database choice for a recreated subsite. */
export type SiteDatabaseChoice =
  | { mode: "workspace" }
  | { mode: "backup" }
  | { mode: "custom"; connection: DatabaseTarget };

export interface RestorePlan {
  /** Hostnames per backed-up site id. The first primary hostname of a subsite becomes its address. */
  hostnames?: Record<string, Array<{ hostname: string; primary?: boolean }>>;
  siteDatabases?: Record<string, SiteDatabaseChoice>;
  pluginDatabases?: Record<string, Record<string, PluginDatabaseChoice>>;
}

export interface DatabaseSummary {
  driver: string;
  host: string;
  port: number;
  database: string;
  username: string;
}

export interface BackupSiteSummary {
  siteId: string;
  siteName: string;
  root: boolean;
  hostnames: Array<{ hostname: string; primary: boolean; kind: string }>;
  records: number;
  users: number;
  mediaFiles: number;
  mediaBytes: number;
  privateFiles: number;
  pluginTables: number;
  pluginRows: number;
  undecryptableSecrets: number;
  database: DatabaseSummary | null;
  pluginDatabases: Array<DatabaseSummary & { pluginId: string }>;
}

export interface BackupSummary {
  kind: "site" | "network";
  createdAt: string;
  source: BackupReader["manifest"]["source"];
  sites: BackupSiteSummary[];
  packages: Array<{ type: string; id: string; version: string; source: string; signed: boolean }>;
  extensions: BackupReader["manifest"]["extensions"];
}

function driver(): BackupDriver {
  const value = process.env.DB_DRIVER;
  return value === "mysql" || value === "mariadb" ? value : "postgres";
}

function describe(connection: { driver?: string; host: string; port: number; database: string; username: string }): DatabaseSummary {
  return {
    driver: String(connection.driver ?? driver()),
    host: connection.host,
    port: Number(connection.port) || 0,
    database: connection.database,
    username: connection.username,
  };
}

/** Plugins that keep their rows in a database of their own, from the backed-up `_host` items. */
function pluginDatabases(envelope: PortableBackupEnvelope): Array<{ pluginId: string; connection: PortableDatabaseConnection }> {
  const result: Array<{ pluginId: string; connection: PortableDatabaseConnection }> = [];
  for (const row of envelope.data.tables.plugin_data ?? []) {
    if (row.collection !== "_host" || row.item_id !== "schema") continue;
    let payload: unknown = row.payload;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        continue;
      }
    }
    const target = (payload as { target?: PortableDatabaseConnection } | null)?.target;
    if (target?.host) result.push({ pluginId: String(row.plugin_id), connection: { ...target, password: "" } });
  }
  return result;
}

/** Decode every site once and report what the backup holds. Any damaged site fails the whole check. */
export function summarizeBackup(reader: BackupReader, signal?: AbortSignal): BackupSummary {
  const sites: BackupSiteSummary[] = [];
  for (const entry of reader.manifest.sites) {
    if (signal?.aborted) throw new Error("Restore cancelled");
    const envelope = reader.readSite(entry);
    const data = envelope.data;
    sites.push({
      siteId: entry.siteId,
      siteName: entry.siteName,
      root: entry.root,
      hostnames: entry.hostnames,
      records: Object.values(data.tables).reduce((sum, rows) => sum + rows.length, 0),
      users: data.tables.users?.length ?? 0,
      mediaFiles: data.files.length,
      mediaBytes: data.files.reduce((sum, file) => sum + file.size, 0),
      privateFiles: data.privateFiles.length,
      pluginTables: data.pluginTables.length,
      pluginRows: data.pluginTables.reduce((sum, table) => sum + table.rows.length, 0),
      undecryptableSecrets: data.undecryptableSecrets,
      database: data.database ? describe(data.database) : null,
      pluginDatabases: pluginDatabases(envelope).map((item) => ({ pluginId: item.pluginId, ...describe(item.connection) })),
    });
  }
  return {
    kind: reader.manifest.kind,
    createdAt: reader.manifest.createdAt,
    source: reader.manifest.source,
    sites,
    packages: reader.manifest.packages.map((item) => ({
      type: item.type,
      id: item.id,
      version: item.version,
      source: item.source,
      signed: Boolean(item.signature),
    })),
    extensions: reader.manifest.extensions,
  };
}

/** Per backed-up site, bundled extensions this installation does not ship. They restore turned off. */
export async function unavailableExtensions(reader: BackupReader): Promise<Record<string, string[]>> {
  const { unavailableBundledExtensions } = await import("./site-restore.js");
  const result: Record<string, string[]> = {};
  for (const entry of reader.manifest.sites) {
    const missing = await unavailableBundledExtensions(reader.readSite(entry));
    if (missing.length > 0) result[entry.siteId] = missing;
  }
  return result;
}

export interface RestoreTargetState {
  clean: boolean;
  existingSubsites: number;
  multisite: boolean;
}

export async function restoreTargetState(rootSiteId: string): Promise<RestoreTargetState> {
  const subsites = await workspaceSubsites(rootSiteId);
  return { clean: subsites.length === 0, existingSubsites: subsites.length, multisite: multisiteEnabled() };
}

/** Take the site as it is now, so a failed restore can put it back. */
async function snapshotSite(siteId: string, installationRoot: boolean): Promise<PortableBackupEnvelope> {
  const exported = await withBackupSiteDatabase(siteId, async () =>
    exportSiteData(await getDb(), siteId, { installationRoot, rollbackSnapshot: true }),
  );
  return {
    format: PORTABLE_BACKUP_FORMAT,
    version: PORTABLE_BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    source: { siteId, siteName: String(exported.data.site.name ?? ""), databaseDriver: driver() },
    integrity: { algorithm: "sha256", data: "" },
    data: exported.data,
  };
}

async function putBack(
  siteId: string,
  snapshot: PortableBackupEnvelope,
  actorId: string | null,
  started: string[],
  installationRoot: boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await withBackupSiteDatabase(siteId, async () => {
      await restoreSiteBackup({
        targetSiteId: siteId,
        actorId,
        envelope: snapshot,
        ids: new IdMap(),
        installationRoot,
        rollback: true,
        packageArchive: () => {
          throw new Error("A rollback does not install packages");
        },
      });
      await stopPluginsAfterRollback(siteId, started, snapshot);
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function packageLookup(reader: BackupReader) {
  const byDigest = new Map(reader.manifest.packages.map((item) => [item.digest, item]));
  return (digest: string) => {
    const meta = byDigest.get(digest);
    if (!meta) throw new Error("The backup is missing a package it refers to");
    const { offset: _offset, length: _length, sha256: _sha, ...rest } = meta;
    return { meta: rest, buffer: reader.packageBytes(digest) };
  };
}

async function testPluginDatabases(choices: Record<string, PluginDatabaseChoice> | undefined, envelope: PortableBackupEnvelope): Promise<void> {
  const { openTargetDatabase } = await import("../plugins/plugin-schema.js");
  const recorded = new Map(pluginDatabases(envelope).map((item) => [item.pluginId, item.connection]));
  for (const [pluginId, choice] of Object.entries(choices ?? {})) {
    if (choice.mode !== "custom") continue;
    if (!recorded.has(pluginId)) throw new Error(`The backup has no separate database for plugin ${pluginId}`);
    try {
      const db = await openTargetDatabase({ ...choice.connection, ssl: choice.connection.ssl ?? false });
      await db.query("SELECT 1");
      await db.close();
    } catch {
      throw new Error(`Could not connect to the database chosen for plugin ${pluginId}`);
    }
  }
}

/**
 * Restore a single-site backup into one existing site. A snapshot of the
 * target taken first is put back if anything fails.
 */
export async function restoreSingleSite(input: {
  targetSiteId: string;
  installationRoot: boolean;
  actorId: string;
  reader: BackupReader;
  plan: RestorePlan;
  signal?: AbortSignal;
  progress?: Progress;
  /** Keeps the pre-restore snapshot where another worker can use it after a crash. */
  onSnapshot?: (snapshot: PortableBackupEnvelope) => Promise<void>;
}): Promise<{ siteId: string }> {
  const entry = input.reader.manifest.sites[0];
  if (input.reader.manifest.kind !== "site" || !entry) throw new Error("Restore a network backup from the network restore");
  const envelope = input.reader.readSite(entry);
  const pluginChoices = input.plan.pluginDatabases?.[entry.siteId];
  await testPluginDatabases(pluginChoices, envelope);
  input.progress?.(1, 4, "Saving the current site for rollback");
  const snapshot = await snapshotSite(input.targetSiteId, input.installationRoot);
  await input.onSnapshot?.(snapshot);
  if (input.signal?.aborted) throw new Error("Restore cancelled");
  const started: string[] = [];
  try {
    await withBackupSiteDatabase(input.targetSiteId, async () =>
      restoreSiteBackup({
        targetSiteId: input.targetSiteId,
        actorId: input.actorId,
        envelope,
        ids: new IdMap(),
        installationRoot: input.installationRoot,
        packageArchive: packageLookup(input.reader),
        pluginDatabases: pluginChoices,
        signal: input.signal,
        activated: started,
        progress: (message) => input.progress?.(2, 4, message),
      }),
    );
  } catch (error) {
    input.progress?.(3, 4, "Putting the site back");
    const restored = await putBack(input.targetSiteId, snapshot, input.actorId, started, input.installationRoot);
    const reason = (error instanceof Error ? error.message : "Restore failed").replace(/\.$/, "");
    throw new Error(
      restored.ok
        ? `${reason}. The site was put back as it was.`
        : `${reason}. Putting the site back also failed (${restored.reason}); restore a recent backup.`,
      { cause: error },
    );
  }
  input.progress?.(4, 4, "Site restored");
  return { siteId: input.targetSiteId };
}

interface MappedHost {
  hostname: string;
  primary: boolean;
  kind: string;
}

/** Validate every hostname the operator chose: valid, unique in the request, and not in use. */
async function mapHostnames(reader: BackupReader, plan: RestorePlan, rootSiteId: string): Promise<Map<string, MappedHost[]>> {
  const result = new Map<string, MappedHost[]>();
  const used = new Set<string>();
  const { platformBaseDomain } = await import("../tenancy/saas-settings.js");
  const base = await platformBaseDomain().catch(() => "");
  for (const entry of reader.manifest.sites) {
    const requested = plan.hostnames?.[entry.siteId] ?? [];
    const hosts: MappedHost[] = [];
    for (const item of requested) {
      const hostname = normalizeHostname(String(item.hostname ?? ""));
      if (!hostname) continue;
      if (!isValidHostname(hostname)) throw new Error(`${hostname} is not a valid hostname`);
      if (used.has(hostname)) throw new Error(`The hostname ${hostname} is used for more than one site`);
      used.add(hostname);
      hosts.push({ hostname, primary: Boolean(item.primary) && !entry.root, kind: siteDomainKind(hostname, base) });
    }
    if (!entry.root) {
      if (hosts.length === 0) throw new Error(`Enter an address for ${entry.siteName}`);
      if (!hosts.some((host) => host.primary)) hosts[0]!.primary = true;
      if (hosts.filter((host) => host.primary).length > 1) throw new Error(`${entry.siteName} can have only one primary address`);
    }
    result.set(entry.siteId, hosts);
  }
  if (used.size > 0) {
    const control = await getControlDb();
    const all = [...used];
    const taken = await control.query<{ hostname: string; site_id: string }>(
      `SELECT hostname, site_id FROM site_domains WHERE hostname IN (${all.map(() => "?").join(", ")})`,
      all,
    );
    const rootEntry = reader.manifest.sites.find((entry) => entry.root);
    const subsiteHosts = new Set(
      [...result.entries()].filter(([siteId]) => siteId !== rootEntry?.siteId).flatMap(([, hosts]) => hosts.map((host) => host.hostname)),
    );
    /** An address the root site already has needs no adding; drop it rather than refuse the restore. */
    const ownRoot = new Set(
      taken.filter((row) => String(row.site_id) === rootSiteId && !subsiteHosts.has(String(row.hostname))).map((row) => String(row.hostname)),
    );
    if (rootEntry) result.set(rootEntry.siteId, (result.get(rootEntry.siteId) ?? []).filter((host) => !ownRoot.has(host.hostname)));
    const conflict = taken.find((row) => !ownRoot.has(String(row.hostname)));
    if (conflict) throw new Error(`The hostname ${String(conflict.hostname)} is already in use on this installation`);
  }
  return result;
}

async function checkSiteDatabases(reader: BackupReader, plan: RestorePlan, envelopes: Map<string, PortableBackupEnvelope>): Promise<Map<string, DatabaseTarget | null>> {
  const { probeSeparateDatabase } = await import("../tenancy/provision.js");
  const result = new Map<string, DatabaseTarget | null>();
  for (const entry of reader.manifest.sites) {
    if (entry.root) continue;
    const source = envelopes.get(entry.siteId)?.data.database ?? null;
    const choice: SiteDatabaseChoice = plan.siteDatabases?.[entry.siteId] ?? (source ? { mode: "backup" } : { mode: "workspace" });
    if (choice.mode === "workspace") {
      result.set(entry.siteId, null);
      continue;
    }
    const target: DatabaseTarget | null =
      choice.mode === "backup"
        ? source && { host: source.host, port: source.port, database: source.database, username: source.username, password: source.password }
        : choice.connection;
    if (!target) throw new Error(`${entry.siteName} did not use a separate database in the backup`);
    const problem = validateDatabaseTarget(target);
    if (problem) throw new Error(`${entry.siteName}: ${problem}`);
    const probe = await probeSeparateDatabase(target);
    if (!probe.ok) throw new Error(`${entry.siteName}: ${probe.error}`);
    result.set(entry.siteId, target);
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
  for (const sql of [
    "DELETE FROM quota_limits WHERE scope = 'site' AND scope_id = ?",
    "DELETE FROM tenant_databases WHERE site_id = ?",
    "DELETE FROM sites WHERE id = ?",
  ]) {
    await control.run(sql, [siteId]).catch(() => {
      complete = false;
    });
  }
  await getUploadStore().deletePrefix(`${siteId}/`).catch(() => {
    complete = false;
  });
  return complete;
}

async function addHostnames(siteId: string, hosts: MappedHost[], skipPrimary: boolean): Promise<void> {
  const control = await getControlDb();
  const stamp = new Date().toISOString();
  for (const host of hosts) {
    if (skipPrimary && host.primary) continue;
    const routable = host.kind !== "custom";
    await control.run(
      `INSERT INTO site_domains (id, site_id, hostname, kind, verified, is_primary, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), siteId, host.hostname, host.kind, routable, false, stamp, routable ? "active" : "pending"],
    );
  }
}

/** Installation-wide state of the root workspace, saved for rollback and replaced from the backup. */
async function installationState(rootSiteId: string): Promise<{ tenant: Row | undefined; settings: Row[]; operators: string[] }> {
  const control = await getControlDb();
  return {
    tenant: (await control.query<Row>("SELECT t.id, t.name, t.user_mode FROM tenants t JOIN sites s ON s.tenant_id = t.id WHERE s.id = ? LIMIT 1", [rootSiteId]))[0],
    settings: await (async () => {
      const columns = await tableColumns(control, "platform_settings", driver());
      return columns ? decodeJsonColumns(await control.query<Row>(`SELECT ${selectColumns(columns, driver())} FROM platform_settings x`, []), columns) : [];
    })(),
    operators: (await control.query<{ user_id: string }>("SELECT user_id FROM platform_operators", [])).map((row) => String(row.user_id)),
  };
}

async function writeInstallation(
  tenantId: string,
  values: { name: string; userMode: string },
  settings: Row[],
  operators: string[],
  ids: IdMap | null,
): Promise<void> {
  const control = await getControlDb();
  const engine = driver();
  const columns = await tableColumns(control, "platform_settings", engine);
  await control.transaction(async (tx) => {
    await tx.run("UPDATE tenants SET name = ?, user_mode = ? WHERE id = ?", [values.name, values.userMode === "shared" ? "shared" : "isolated", tenantId]);
    if (columns) {
      await tx.run("DELETE FROM platform_settings", []);
      const rows = settings.map((row) => (ids ? (importSecrets(ids.apply(row)) as Row) : row));
      await insertRows(tx, "platform_settings", columns, rows, engine);
    }
    const existing = new Set((await tx.query<{ user_id: string }>("SELECT user_id FROM platform_operators", [])).map((row) => String(row.user_id)));
    for (const operator of operators) {
      const userId = ids ? String(ids.apply(operator)) : operator;
      if (existing.has(userId)) continue;
      const present = await tx.query<{ id: string }>("SELECT id FROM users WHERE id = ? LIMIT 1", [userId]);
      if (!present[0]) continue;
      await tx.run("INSERT INTO platform_operators (user_id, created_at) VALUES (?, ?)", [userId, new Date().toISOString()]);
      existing.add(userId);
    }
  });
}

export interface NetworkRestoreResult {
  rootSiteId: string;
  sites: Array<{ sourceSiteId: string; siteId: string; siteName: string; hostname: string | null }>;
}

/**
 * Rebuild a whole network on a clean installation.
 *
 * Everything is checked first: the archive, each address, and each database
 * connection. The root site is restored first, because subsites can only use
 * a plugin after the root has created its tables. Subsites are created
 * offline and only go live once every site is restored. Any failure or a
 * cancellation removes the new subsites and puts the root site and the
 * installation settings back from the snapshot taken at the start.
 */
export async function restoreNetwork(input: {
  rootSiteId: string;
  actorId: string;
  reader: BackupReader;
  plan: RestorePlan;
  signal?: AbortSignal;
  progress?: Progress;
  /** Receives subsites as they are created, so an interrupted job can clean them up. */
  onSiteCreated?: (siteId: string) => Promise<void> | void;
  onSnapshot?: (snapshot: PortableBackupEnvelope) => Promise<void>;
}): Promise<NetworkRestoreResult> {
  const { rootSiteId, reader, plan, signal } = input;
  const manifest = reader.manifest;
  if (manifest.kind !== "network") throw new Error("Restore a single-site backup into one site");
  const rootEntry = manifest.sites[0]!;
  const subsites = manifest.sites.filter((entry) => !entry.root);
  const control = await getControlDb();
  const tenantId = String((await control.query<{ tenant_id: string }>("SELECT tenant_id FROM sites WHERE id = ? LIMIT 1", [rootSiteId]))[0]?.tenant_id ?? "");
  if (!tenantId) throw new Error("Installation root site not found");
  if (subsites.length > 0 && !multisiteEnabled()) throw new Error("Turn on multisite (JF_MULTISITE=true) before restoring a network with subsites");
  const existing = await workspaceSubsites(rootSiteId);
  if (existing.length > 0) {
    throw new Error(`Network restore needs a clean installation, but this workspace already has ${existing.length} subsite${existing.length === 1 ? "" : "s"}`);
  }

  const total = manifest.sites.length * 2 + 3;
  let step = 0;
  const report = (message: string) => input.progress?.(++step, total, message);
  const envelopes = new Map<string, PortableBackupEnvelope>();
  for (const entry of manifest.sites) {
    if (signal?.aborted) throw new Error("Restore cancelled");
    envelopes.set(entry.siteId, reader.readSite(entry));
    report(`Checked ${entry.siteName}`);
  }
  const hostnames = await mapHostnames(reader, plan, rootSiteId);
  const databases = await checkSiteDatabases(reader, plan, envelopes);
  for (const entry of manifest.sites) await testPluginDatabases(plan.pluginDatabases?.[entry.siteId], envelopes.get(entry.siteId)!);

  report("Saving the current installation for rollback");
  const rootSnapshot = await snapshotSite(rootSiteId, true);
  await input.onSnapshot?.(rootSnapshot);
  const installationBefore = await installationState(rootSiteId);
  const ids = new IdMap();
  const packageArchive = packageLookup(reader);
  const rootStarted: string[] = [];
  const created: Array<{ entry: ContainerSiteEntry; siteId: string; hostname: string }> = [];
  const actorEmail = String((await withBackupSiteDatabase(rootSiteId, async () => (await getDb()).query<{ email: string }>("SELECT email FROM users WHERE id = ? LIMIT 1", [input.actorId])))[0]?.email ?? "").toLowerCase();

  const rollback = async (cause: unknown): Promise<never> => {
    let complete = true;
    const problems: string[] = [];
    for (const site of created) {
      if (!(await discardCreatedSite(site.siteId))) {
        complete = false;
        problems.push(`subsite ${site.entry.siteName}`);
      }
    }
    const extra = [...(hostnames.get(rootEntry.siteId) ?? [])].map((host) => host.hostname);
    if (extra.length > 0) {
      await control.run(`DELETE FROM site_domains WHERE hostname IN (${extra.map(() => "?").join(", ")})`, extra).catch(() => {
        complete = false;
      });
    }
    const putBackResult = await putBack(rootSiteId, rootSnapshot, input.actorId, rootStarted, true);
    if (!putBackResult.ok) {
      complete = false;
      problems.push(`the root site (${putBackResult.reason})`);
    }
    if (installationBefore.tenant) {
      await writeInstallation(
        tenantId,
        { name: String(installationBefore.tenant.name), userMode: String(installationBefore.tenant.user_mode) },
        installationBefore.settings,
        installationBefore.operators,
        null,
      ).catch(() => {
        complete = false;
      });
    }
    const reason = (cause instanceof Error ? cause.message : "Network restore failed").replace(/\.$/, "");
    throw new Error(
      complete
        ? `${reason}. The new subsites were removed and the root site was put back as it was.`
        : `${reason}. Rolling back was incomplete for ${problems.join(", ") || "the installation settings"}; check Platform for offline subsites and restore a recent backup of the root site.`,
      { cause },
    );
  };

  try {
    if (signal?.aborted) throw new Error("Restore cancelled");
    await withBackupSiteDatabase(rootSiteId, async () =>
      restoreSiteBackup({
        targetSiteId: rootSiteId,
        actorId: input.actorId,
        envelope: envelopes.get(rootEntry.siteId)!,
        ids,
        installationRoot: true,
        packageArchive,
        pluginDatabases: plan.pluginDatabases?.[rootEntry.siteId],
        signal,
        activated: rootStarted,
        progress: (message) => input.progress?.(step, total, message),
      }),
    );
    report(`Restored ${rootEntry.siteName}`);
    if (manifest.installation) {
      await writeInstallation(
        tenantId,
        manifest.installation.tenant,
        manifest.installation.platformSettings,
        manifest.installation.platformOperators,
        ids,
      );
    }
    await addHostnames(rootSiteId, hostnames.get(rootEntry.siteId) ?? [], false);

    for (const entry of subsites) {
      if (signal?.aborted) throw new Error("Restore cancelled");
      const hosts = hostnames.get(entry.siteId) ?? [];
      const primary = hosts.find((host) => host.primary)!;
      const database = databases.get(entry.siteId) ?? null;
      const { createAdditionalSite } = await import("../tenancy/provision.js");
      const site = await createAdditionalSite({
        tenantId,
        name: entry.siteName,
        hostname: primary.hostname,
        databaseChoice: database ? "separate" : "inherit",
        ...(database ? { database } : {}),
        adminFrom: { siteId: rootSiteId, userId: input.actorId },
        actorId: input.actorId,
        initialStatus: "provisioning",
      });
      if (!site.ok) throw new Error(`${entry.siteName}: ${site.error}`);
      created.push({ entry, siteId: site.siteId, hostname: primary.hostname });
      await input.onSiteCreated?.(site.siteId);
      await addHostnames(site.siteId, hosts, true);
      await withBackupSiteDatabase(site.siteId, async () => {
        const db = await getDb();
        const copied = actorEmail
          ? (await db.query<{ id: string }>("SELECT id FROM users WHERE site_id = ? AND LOWER(email) = ? LIMIT 1", [site.siteId, actorEmail]))[0]
          : undefined;
        await restoreSiteBackup({
          targetSiteId: site.siteId,
          actorId: copied ? String(copied.id) : null,
          envelope: envelopes.get(entry.siteId)!,
          ids,
          installationRoot: false,
          packageArchive,
          pluginDatabases: plan.pluginDatabases?.[entry.siteId],
          signal,
          progress: (message) => input.progress?.(step, total, `${entry.siteName}: ${message}`),
        });
      });
      envelopes.delete(entry.siteId);
      report(`Restored ${entry.siteName}`);
    }
    if (signal?.aborted) throw new Error("Restore cancelled");
  } catch (error) {
    return rollback(error);
  }

  for (const site of created) {
    await control.run("UPDATE sites SET status = 'active', active = ? WHERE id = ?", [true, site.siteId]);
  }
  report("Network restored");
  return {
    rootSiteId,
    sites: [
      { sourceSiteId: rootEntry.siteId, siteId: rootSiteId, siteName: rootEntry.siteName, hostname: null },
      ...created.map((site) => ({ sourceSiteId: site.entry.siteId, siteId: site.siteId, siteName: site.entry.siteName, hostname: site.hostname })),
    ],
  };
}

/** Remove subsites an interrupted network restore created; used when a worker stopped mid-restore. */
export async function discardInterruptedSites(siteIds: string[]): Promise<boolean> {
  let complete = true;
  for (const siteId of siteIds) {
    const control = await getControlDb();
    const rows = await control.query<{ status: string }>("SELECT status FROM sites WHERE id = ? LIMIT 1", [siteId]);
    if (rows[0] && rows[0].status !== "provisioning") continue;
    if (!(await discardCreatedSite(siteId))) complete = false;
  }
  return complete;
}

/** Put a site back from a stored pre-restore snapshot, after the worker running the restore stopped. */
export async function restoreRollbackSnapshot(siteId: string, snapshot: PortableBackupEnvelope): Promise<boolean> {
  const { isInstallationRootSite } = await import("../tenancy/registry.js");
  return (await putBack(siteId, snapshot, null, [], await isInstallationRootSite(siteId))).ok;
}
