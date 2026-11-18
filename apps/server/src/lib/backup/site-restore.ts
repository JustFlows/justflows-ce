// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { getControlDb, getDb, type DbClient } from "../database/db.js";
import { getUploadStore, isSafeUploadKey } from "../media/upload-store.js";
import { siteThemesDir } from "../extensions/packages-dir.js";
import { resolvePathUnderBase } from "../security/safe-path.js";
import { encryptSecret } from "../security/secret-box.js";
import type { PortableBackupEnvelope, PortableDatabaseConnection, PortablePluginTable } from "./portable-archive.js";
import { installPackageFromBackup, type RetainedPackageMeta } from "./package-archives.js";
import {
  deleteSiteRowsSql,
  hasOwnSiteColumn,
  IdMap,
  importSecrets,
  insertRows,
  parentsFirst,
  quoteIdent,
  SITE_TABLES,
  tableColumns,
  type BackupDriver,
  type ColumnInfo,
} from "./site-tables.js";

type Row = Record<string, unknown>;

/** The operator's choice for a plugin's own database: keep the backup's, use another, or the site database. */
export type PluginDatabaseChoice =
  | { mode: "backup" }
  | { mode: "site" }
  | { mode: "custom"; connection: PortableDatabaseConnection };

export interface SiteRestoreInput {
  targetSiteId: string;
  /** The administrator running the restore keeps their account and session. */
  actorId: string | null;
  envelope: PortableBackupEnvelope;
  /** Shared by every site of a network restore. */
  ids: IdMap;
  /** The target is the installation root, so plugin rows without a site column belong to it. */
  installationRoot: boolean;
  /** Package archives by digest, from the backup. */
  packageArchive(digest: string): { meta: RetainedPackageMeta; buffer: Buffer };
  pluginDatabases?: Record<string, PluginDatabaseChoice>;
  /**
   * A snapshot taken of this same site just before a restore, put back after
   * a failure: its rows already point at packages installed here.
   */
  rollback?: boolean;
  signal?: AbortSignal;
  progress?: (message: string) => void;
  /** Receives each plugin as it is started, so a failed restore can stop them again. */
  activated?: string[];
  /** Receives bundled extensions this installation does not ship; they are restored turned off. */
  unavailable?: string[];
}

export interface SiteRestoreResult {
  /** Plugins this restore turned on, so a rollback can turn them off again. */
  activatedPlugins: string[];
}

const PROTECTED_SITE_COLUMNS = new Set(["id", "tenant_id", "url", "status", "active", "database_choice", "installed_at", "created_at"]);
const PLUGIN_HOST_SCHEMA = "schema";
const PLUGIN_HOST_PASSWORD = "schemaPassword";

function driver(): BackupDriver {
  const value = process.env.DB_DRIVER;
  return value === "mysql" || value === "mariadb" ? value : "postgres";
}

function parseJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return { ...(value as Record<string, unknown>) };
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Restore cancelled");
}

/** The bundled folder on this installation, or null when it does not ship here. */
export async function bundledFolder(table: "plugins" | "themes" | "css_providers", folder: string): Promise<string | null> {
  const base =
    table === "plugins"
      ? (await import("../plugins/plugins-db.js")).pluginsDir()
      : table === "themes"
        ? (await import("../themes/theme-files.js")).themesDir()
        : (await import("../extensions/css-providers-db.js")).cssProvidersDir();
  const dir = resolvePathUnderBase(base, folder);
  if (!dir || !(await fsp.stat(dir).then((stat) => stat.isDirectory(), () => false))) return null;
  return dir;
}

const ID_COLUMN = { plugins: "plugin_id", themes: "theme_id", css_providers: "provider_id" } as const;

/**
 * Bundled extensions a backup refers to that this installation does not ship.
 * Their rows and data are restored, but they stay turned off.
 */
export async function unavailableBundledExtensions(envelope: PortableBackupEnvelope): Promise<string[]> {
  const missing: string[] = [];
  for (const item of envelope.data.packages) {
    if (item.ref.kind !== "bundled") continue;
    if (await bundledFolder(item.table, item.ref.folder)) continue;
    const row = (envelope.data.tables[item.table] ?? []).find((candidate) => String(candidate.id) === item.rowId);
    missing.push(String(row?.[ID_COLUMN[item.table]] ?? item.ref.folder));
  }
  return missing;
}

/**
 * Point every plugin, theme and CSS provider row at files on this
 * installation: verified package installs, the site's theme forks, or bundled
 * folders. Runs before any site data changes, so a refused package stops the
 * restore while the target is still untouched.
 */
async function resolveExtensionRows(input: SiteRestoreInput, tables: Record<string, Row[]>): Promise<void> {
  if (input.rollback) return;
  const installed = new Map<string, string>();
  const refs = new Map(input.envelope.data.packages.map((item) => [`${item.table}:${item.rowId}`, item.ref]));
  for (const table of ["plugins", "themes", "css_providers"] as const) {
    for (const row of tables[table] ?? []) {
      const ref = refs.get(`${table}:${String(row.id)}`) ?? refs.get(`${table}:${String(input.ids.get(String(row.id)) ?? "")}`);
      const manifest = parseJson(row.manifest);
      delete manifest.installedPath;
      delete manifest.bundledPath;
      if (!ref || ref.kind === "builtin") {
        row.manifest = JSON.stringify(manifest);
        continue;
      }
      if (ref.kind === "package") {
        let dir = installed.get(ref.digest);
        if (!dir) {
          const archive = input.packageArchive(ref.digest);
          input.progress?.(`Verifying ${archive.meta.id} ${archive.meta.version}`);
          dir = await installPackageFromBackup(archive.meta, archive.buffer);
          installed.set(ref.digest, dir);
        }
        manifest.installedPath = dir;
      } else if (ref.kind === "fork") {
        const root = siteThemesDir(input.targetSiteId);
        const dir = root ? resolvePathUnderBase(root, String(row.theme_id)) : null;
        if (!dir) throw new Error("A restored theme has an unsafe folder");
        manifest.installedPath = dir;
      } else {
        const dir = await bundledFolder(table, ref.folder);
        if (dir) manifest.bundledPath = dir;
        else {
          /** The code is not on this server: keep the row and its data, but leave it off. */
          if (table === "plugins" && row.status === "active") row.status = "inactive";
          input.unavailable?.push(String(row[ID_COLUMN[table]] ?? ref.folder));
        }
      }
      row.manifest = JSON.stringify(manifest);
    }
  }
}

/** Give every backed-up row a new id unless the backup is restored onto its own site. */
async function prepareIds(input: SiteRestoreInput, db: Pick<DbClient, "query">): Promise<void> {
  const { envelope, ids, targetSiteId } = input;
  const data = envelope.data;
  const sourceSiteId = envelope.source.siteId;
  if (sourceSiteId !== targetSiteId) {
    ids.set(sourceSiteId, targetSiteId);
    for (const rows of Object.values(data.tables)) ids.assignRowIds(rows, randomUUID);
    for (const table of data.pluginTables) ids.assignRowIds(table.rows, randomUUID);
  }
  if (!input.actorId) return;
  const actor = (await db.query<{ email: string }>("SELECT email FROM users WHERE id = ? LIMIT 1", [input.actorId]))[0];
  const email = String(actor?.email ?? "").toLowerCase();
  const match = (data.tables.users ?? []).find((user) => String(user.email ?? "").toLowerCase() === email);
  if (email && match) ids.set(String(match.id), input.actorId);
}

function remapRows(rows: Row[], input: SiteRestoreInput, siteColumn: boolean): Row[] {
  return rows.map((row) => {
    const mapped = importSecrets(input.ids.apply(row)) as Row;
    if (siteColumn) mapped.site_id = input.targetSiteId;
    return mapped;
  });
}

/**
 * Users are updated in place rather than deleted and re-inserted: another
 * site's memberships can point at them (shared users), and a delete would
 * cascade those away. Accounts the backup does not have are removed, except
 * the administrator running the restore.
 */
async function replaceUsers(
  tx: Pick<DbClient, "run" | "query">,
  columns: ColumnInfo[],
  rows: Row[],
  engine: BackupDriver,
  siteId: string,
  actorId: string,
): Promise<void> {
  const { importValue } = await import("./site-tables.js");
  const existing = new Set(
    (await tx.query<{ id: string }>("SELECT id FROM users WHERE site_id = ?", [siteId])).map((row) => String(row.id)),
  );
  const incoming = new Set(rows.map((row) => String(row.id)));
  for (const id of existing) {
    if (!incoming.has(id) && id !== actorId) await tx.run("DELETE FROM users WHERE id = ?", [id]);
  }
  const byName = new Map(columns.map((column) => [column.name, column]));
  const inserts: Row[] = [];
  for (const row of rows) {
    if (!existing.has(String(row.id))) {
      inserts.push(row);
      continue;
    }
    const names = Object.keys(row).filter((name) => name !== "id" && byName.has(name));
    if (names.length === 0) continue;
    await tx.run(
      `UPDATE users SET ${names.map((name) => `${quoteIdent(name, engine)} = ?`).join(", ")} WHERE id = ?`,
      [...names.map((name) => importValue(row[name], byName.get(name)!, engine)), String(row.id)],
    );
  }
  await insertRows(tx, "users", columns, inserts, engine);
}

/** Replace the site's core tables and update its own row, in one transaction. */
async function replaceCoreTables(input: SiteRestoreInput, tables: Record<string, Row[]>): Promise<void> {
  const db = await getDb();
  const engine = driver();
  const columns = new Map<string, ColumnInfo[]>();
  for (const table of SITE_TABLES) {
    const info = await tableColumns(db, table, engine);
    if (info) columns.set(table, info);
  }
  const siteColumns = await tableColumns(db, "sites", engine);
  const actorId = input.actorId ?? "";
  await db.transaction(async (tx) => {
    /** A table the backup does not carry (an older format) is left as it is. */
    for (const table of [...SITE_TABLES].reverse()) {
      if (!columns.has(table) || table === "users" || !(table in tables)) continue;
      await tx.run(deleteSiteRowsSql(table, engine), [input.targetSiteId]);
    }
    for (const table of SITE_TABLES) {
      const info = columns.get(table);
      if (!info || !(table in tables)) continue;
      let rows = remapRows(tables[table] ?? [], input, hasOwnSiteColumn(table));
      if (table === "users") {
        await replaceUsers(tx, info, rows.filter((row) => row.id !== actorId), engine, input.targetSiteId, actorId);
        continue;
      }
      if (table === "site_memberships" && rows.length > 0) {
        const userIds = [...new Set(rows.map((row) => String(row.user_id)))];
        const present = new Set(
          (await tx.query<{ id: string }>(`SELECT id FROM users WHERE id IN (${userIds.map(() => "?").join(", ")})`, userIds)).map((row) => String(row.id)),
        );
        rows = rows.filter((row) => present.has(String(row.user_id)));
      }
      await insertRows(tx, table, info, parentsFirst(rows), engine);
    }
    if (siteColumns) {
      const source = importSecrets(input.ids.apply(input.envelope.data.site)) as Row;
      const updatable = siteColumns.filter((column) => !PROTECTED_SITE_COLUMNS.has(column.name) && column.name in source);
      if (updatable.length > 0) {
        const { importValue } = await import("./site-tables.js");
        await tx.run(
          `UPDATE sites SET ${updatable.map((column) => `${quoteIdent(column.name, engine)} = ?`).join(", ")} WHERE id = ?`,
          [...updatable.map((column) => importValue(source[column.name], column, engine)), input.targetSiteId],
        );
      }
    }
  });
}

/** Site limits live in the routing database. */
async function replaceQuotaLimits(input: SiteRestoreInput): Promise<void> {
  const control = await getControlDb();
  const engine = driver();
  const info = await tableColumns(control, "quota_limits", engine);
  if (!info) return;
  await control.transaction(async (tx) => {
    await tx.run("DELETE FROM quota_limits WHERE scope = 'site' AND scope_id = ?", [input.targetSiteId]);
    const rows = input.envelope.data.quotaLimits.map((row) => ({ ...row, scope: "site", scope_id: input.targetSiteId }));
    await insertRows(tx, "quota_limits", info, rows, engine);
  });
}

/** Media, private files and theme forks. Files the backup does not have are removed. */
async function replaceFiles(input: SiteRestoreInput, previousMediaKeys: string[], previousPrivate: Row[]): Promise<void> {
  const data = input.envelope.data;
  const store = getUploadStore();
  const target = input.targetSiteId;
  const written = new Set<string>();
  for (const file of data.files) {
    checkCancelled(input.signal);
    const key = String(input.ids.apply(file.key));
    if (!key.startsWith(`${target}/`) || !isSafeUploadKey(key)) throw new Error("Backup contains an unsafe media key");
    await store.put(key, Buffer.from(file.data, "base64"), file.mimeType);
    written.add(key);
  }
  for (const key of previousMediaKeys) {
    if (!written.has(key) && key.startsWith(`${target}/`) && isSafeUploadKey(key)) await store.delete(key).catch(() => undefined);
  }

  const { localPrivateBackend, objectKey, privateBackendById, privateLocalRoot } = await import("../files/private-storage.js");
  const local = localPrivateBackend(privateLocalRoot());
  const kept = new Set<string>();
  for (const file of data.privateFiles) {
    checkCancelled(input.signal);
    const object = objectKey(target, file.owner, file.key);
    await local.put(object, Buffer.from(file.data, "base64"), file.contentType);
    kept.add(object);
  }
  for (const row of previousPrivate) {
    const object = objectKey(target, String(row.owner), String(row.file_key));
    if (kept.has(object)) continue;
    const backend = await privateBackendById(target, String(row.storage_id));
    await backend?.delete(object).catch(() => undefined);
  }
  await (await getDb()).run("UPDATE private_files SET storage_id = ? WHERE site_id = ?", [local.id, target]);

  const forks = siteThemesDir(target);
  const forkIds = new Set(data.themeFiles.map((file) => file.themeId));
  if (forks) {
    for (const themeId of forkIds) {
      const dir = resolvePathUnderBase(forks, themeId);
      if (!dir) throw new Error("A restored theme has an unsafe folder");
      await fsp.rm(dir, { recursive: true, force: true });
    }
    for (const file of data.themeFiles) {
      const dest = resolvePathUnderBase(forks, file.themeId, ...file.path.split("/"));
      if (!dest) throw new Error("A restored theme file has an unsafe path");
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, Buffer.from(file.data, "base64"));
    }
  }
}

/** Apply the operator's database choice for each plugin that keeps its rows elsewhere. */
async function applyPluginDatabaseChoices(input: SiteRestoreInput): Promise<void> {
  const { setPluginHostItem, deletePluginHostItem } = await import("../plugins/plugin-kv.js");
  for (const [pluginId, choice] of Object.entries(input.pluginDatabases ?? {})) {
    if (choice.mode === "backup") continue;
    if (choice.mode === "site") {
      await deletePluginHostItem(pluginId, input.targetSiteId, PLUGIN_HOST_SCHEMA);
      await deletePluginHostItem(pluginId, input.targetSiteId, PLUGIN_HOST_PASSWORD);
      continue;
    }
    const { password, ...target } = choice.connection;
    const tables = input.envelope.data.pluginTables.filter((table) => table.pluginId === pluginId).map((table) => table.table);
    await setPluginHostItem(pluginId, input.targetSiteId, PLUGIN_HOST_SCHEMA, { tables, target: { ...target, ssl: target.ssl ?? false } });
    await setPluginHostItem(pluginId, input.targetSiteId, PLUGIN_HOST_PASSWORD, encryptSecret(password));
  }
}

/** Turn on the plugins the backup had active, exactly as the server does at start-up. */
async function activatePlugins(input: SiteRestoreInput, tables: Record<string, Row[]>): Promise<string[]> {
  const { runtimeActivatePlugin, runtimeUnloadPlugin } = await import("../plugins/plugin-runtime.js");
  const activated: string[] = [];
  for (const row of tables.plugins ?? []) {
    if (row.status !== "active") continue;
    checkCancelled(input.signal);
    const pluginId = String(row.plugin_id);
    input.progress?.(`Starting plugin ${pluginId}`);
    if (!input.rollback) await runtimeUnloadPlugin(pluginId);
    if (input.rollback) {
      /** A plugin that could not start before the restore must not block putting the site back. */
      try {
        await runtimeActivatePlugin(input.targetSiteId, pluginId);
      } catch {
        continue;
      }
    } else {
      await runtimeActivatePlugin(input.targetSiteId, pluginId);
    }
    activated.push(pluginId);
    input.activated?.push(pluginId);
  }
  return activated;
}

async function pluginTableDatabase(input: SiteRestoreInput, table: PortablePluginTable): Promise<{ db: DbClient; engine: BackupDriver; close: boolean }> {
  const choice = input.pluginDatabases?.[table.pluginId];
  if (!table.remote || choice?.mode === "site") return { db: await getDb(), engine: driver(), close: false };
  const { getPluginHostItem } = await import("../plugins/plugin-kv.js");
  const { decryptSecret } = await import("../security/secret-box.js");
  const meta = await getPluginHostItem<{ target?: PortableDatabaseConnection }>(table.pluginId, input.targetSiteId, PLUGIN_HOST_SCHEMA);
  if (!meta?.target) throw new Error(`Plugin ${table.pluginId} has no database to restore its rows into`);
  const password = decryptSecret((await getPluginHostItem<string>(table.pluginId, input.targetSiteId, PLUGIN_HOST_PASSWORD)) ?? "");
  const { openTargetDatabase } = await import("../plugins/plugin-schema.js");
  const db = await openTargetDatabase({ ...meta.target, password, ssl: meta.target.ssl ?? false });
  return { db, engine: meta.target.driver, close: true };
}

/** Replace each plugin table's rows for this site with the backup's. */
async function replacePluginTables(input: SiteRestoreInput): Promise<void> {
  for (const table of input.envelope.data.pluginTables) {
    if (!table.siteScoped && !input.installationRoot) continue;
    if (input.unavailable?.includes(table.pluginId)) {
      const probe = await pluginTableDatabase(input, table);
      const exists = await tableColumns(probe.db, table.table, probe.engine).finally(async () => {
        if (probe.close) await probe.db.close();
      });
      /** A plugin whose code is missing cannot create its tables; its rows wait in plugin data. */
      if (!exists) continue;
    }
    checkCancelled(input.signal);
    const handle = await pluginTableDatabase(input, table);
    try {
      const columns = await tableColumns(handle.db, table.table, handle.engine);
      if (!columns) throw new Error(`Plugin ${table.pluginId} did not create its table ${table.table}`);
      const rows = remapRows(table.rows, input, table.siteScoped);
      await handle.db.transaction(async (tx) => {
        await tx.run(
          table.siteScoped
            ? `DELETE FROM ${quoteIdent(table.table, handle.engine)} WHERE ${quoteIdent("site_id", handle.engine)} = ?`
            : `DELETE FROM ${quoteIdent(table.table, handle.engine)}`,
          table.siteScoped ? [input.targetSiteId] : [],
        );
        await insertRows(tx, table.table, columns, parentsFirst(rows), handle.engine);
      });
    } finally {
      if (handle.close) await handle.db.close();
    }
  }
}

/**
 * Replace one site with a backup. The caller selects the site's database and
 * keeps a snapshot for rollback: steps after the core transaction (files,
 * plugin start-up, plugin rows) are not atomic on their own.
 */
export async function restoreSiteBackup(input: SiteRestoreInput): Promise<SiteRestoreResult> {
  checkCancelled(input.signal);
  const db = await getDb();
  const tables: Record<string, Row[]> = Object.fromEntries(
    Object.entries(input.envelope.data.tables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]),
  );
  await resolveExtensionRows(input, tables);
  await prepareIds(input, db);
  const previousMedia = (await db.query<{ storage_key: string }>("SELECT storage_key FROM media WHERE site_id = ?", [input.targetSiteId])).map((row) => String(row.storage_key));
  const previousPrivate = await db.query<Row>("SELECT owner, file_key, storage_id FROM private_files WHERE site_id = ?", [input.targetSiteId]);
  checkCancelled(input.signal);
  input.progress?.("Replacing site data");
  await replaceCoreTables(input, tables);
  await replaceQuotaLimits(input);
  input.progress?.("Writing files");
  await replaceFiles(input, previousMedia, previousPrivate);
  await applyPluginDatabaseChoices(input);
  const activatedPlugins = await activatePlugins(input, tables);
  await replacePluginTables(input);
  const { revalidateOnUpdate } = await import("../cache/cache-revalidate.js");
  await revalidateOnUpdate("plugin", { siteId: input.targetSiteId }).catch(() => undefined);
  return { activatedPlugins };
}

/** Turn off plugins a failed restore started that the restored snapshot does not have active. */
export async function stopPluginsAfterRollback(siteId: string, started: string[], snapshot: PortableBackupEnvelope): Promise<void> {
  const active = new Set((snapshot.data.tables.plugins ?? []).filter((row) => row.status === "active").map((row) => String(row.plugin_id)));
  const { runtimeDeactivatePlugin } = await import("../plugins/plugin-runtime.js");
  for (const pluginId of started) {
    if (!active.has(pluginId)) await runtimeDeactivatePlugin(siteId, pluginId).catch(() => undefined);
  }
}
