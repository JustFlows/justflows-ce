// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import type { DbClient } from "../database/db.js";
import { getControlDb } from "../database/db.js";
import { getUploadStore, isSafeUploadKey } from "../media/upload-store.js";
import { decryptSecret } from "../security/secret-box.js";
import { siteThemesDir } from "../extensions/packages-dir.js";
import { resolvePathUnderBase } from "../security/safe-path.js";
import type { ExtensionPackageType } from "../security/extension-integrity.js";
import {
  MAX_PORTABLE_MEDIA_BYTES,
  type PortableBackupData,
  type PortableDatabaseConnection,
  type PortablePluginTable,
  type PortableThemeFile,
} from "./portable-archive.js";
import { packageForRow, type RetainedPackageMeta } from "./package-archives.js";
import {
  exportSecrets,
  exportValue,
  decodeJsonColumns,
  quoteIdent,
  selectColumns,
  SITE_TABLES,
  siteRowsSql,
  tableColumns,
  type BackupDriver,
} from "./site-tables.js";
import type { SiteHostname } from "./backup-container.js";

type Row = Record<string, unknown>;
type Options = { signal?: AbortSignal; progress?: (completed: number, total: number) => void };

const MAX_THEME_FILES = 5000;
const MAX_THEME_BYTES = 64 * 1024 * 1024;

export interface SiteExport {
  data: PortableBackupData;
  packages: Array<{ meta: RetainedPackageMeta; buffer: Buffer }>;
  hostnames: SiteHostname[];
}

function driver(): BackupDriver {
  const value = process.env.DB_DRIVER;
  return value === "mysql" || value === "mariadb" ? value : "postgres";
}

function portableRow(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, exportValue(value)]));
}

function parseJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Backup cancelled");
}

/** Read a core table's rows for one site; a table this installation does not have yet is empty. */
async function readTable(
  db: Pick<DbClient, "query">,
  table: (typeof SITE_TABLES)[number],
  siteId: string,
  engine: BackupDriver,
): Promise<Row[]> {
  const columns = await tableColumns(db, table, engine);
  if (!columns) return [];
  return decodeJsonColumns(await db.query<Row>(siteRowsSql(table, engine, columns), [siteId]), columns).map(portableRow);
}

/** Plugin-owned tables in one database: rows of this site, and unscoped rows when `includeUnscoped`. */
async function readPluginTables(
  db: Pick<DbClient, "query">,
  pluginId: string,
  siteId: string,
  engine: BackupDriver,
  remote: boolean,
  includeUnscoped: boolean,
): Promise<PortablePluginTable[]> {
  const { isPluginOwnedTable, pluginOwnedTableLikePattern } = await import("../plugins/plugin-schema.js");
  let tables: string[];
  try {
    /**
     * information_schema only: the shared helper's SHOW TABLES fallback cannot
     * be prepared inside a MySQL transaction.
     */
    const rows = await db.query<Record<string, unknown>>(
      engine === "postgres"
        ? "SELECT tablename AS table_name FROM pg_catalog.pg_tables WHERE schemaname = current_schema() AND tablename LIKE ? ESCAPE '!'"
        : "SELECT TABLE_NAME AS table_name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME LIKE ? ESCAPE '!'",
      [pluginOwnedTableLikePattern(pluginId)],
    );
    tables = rows
      .map((row) => String(row.table_name ?? row.TABLE_NAME ?? ""))
      .filter((name) => isPluginOwnedTable(pluginId, name))
      .sort();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not list the tables of plugin ${pluginId}: ${reason}`, { cause: error });
  }
  const result: PortablePluginTable[] = [];
  for (const table of tables) {
    const columns = await tableColumns(db, table, engine);
    if (!columns) continue;
    const siteScoped = columns.some((column) => column.name === "site_id");
    if (!siteScoped && !includeUnscoped) continue;
    const list = selectColumns(columns, engine);
    const rows = await db.query<Row>(
      siteScoped
        ? `SELECT ${list} FROM ${quoteIdent(table, engine)} x WHERE x.${quoteIdent("site_id", engine)} = ?`
        : `SELECT ${list} FROM ${quoteIdent(table, engine)} x`,
      siteScoped ? [siteId] : [],
    );
    result.push({ pluginId, table, remote, siteScoped, rows: decodeJsonColumns(rows, columns).map(portableRow) });
  }
  return result;
}

/** Rows in a database a plugin recorded for itself, read with its stored credentials. */
async function readRemotePluginTables(pluginId: string, siteId: string): Promise<PortablePluginTable[]> {
  const { getPluginHostItem, PLUGIN_HOST_SCHEMA_ITEM, PLUGIN_HOST_SCHEMA_PASSWORD_ITEM } = await import("../plugins/plugin-kv.js");
  const meta = await getPluginHostItem<{ target?: { driver: BackupDriver; host: string; port: number; database: string; username: string; ssl: boolean } }>(
    pluginId,
    siteId,
    PLUGIN_HOST_SCHEMA_ITEM,
  );
  if (!meta?.target) return [];
  const password = decryptSecret((await getPluginHostItem<string>(pluginId, siteId, PLUGIN_HOST_SCHEMA_PASSWORD_ITEM)) ?? "");
  const { openTargetDatabase } = await import("../plugins/plugin-schema.js");
  let remote: DbClient;
  try {
    remote = await openTargetDatabase({ ...meta.target, password });
  } catch (error) {
    throw new Error(`Could not reach the separate database of plugin ${pluginId}`, { cause: error });
  }
  try {
    return await readPluginTables(remote, pluginId, siteId, meta.target.driver, true, false);
  } finally {
    await remote.close();
  }
}

async function readThemeFork(siteId: string, themeId: string, budget: { files: number; bytes: number }): Promise<PortableThemeFile[]> {
  const root = siteThemesDir(siteId);
  const dir = root ? resolvePathUnderBase(root, themeId) : null;
  if (!dir) throw new Error(`Theme ${themeId} has an unsafe folder`);
  const files: PortableThemeFile[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Theme ${themeId} contains a link or special file`);
      const data = await fsp.readFile(full);
      budget.files += 1;
      budget.bytes += data.byteLength;
      if (budget.files > MAX_THEME_FILES || budget.bytes > MAX_THEME_BYTES) throw new Error("Site themes exceed the backup size limit");
      files.push({
        themeId,
        path: path.relative(dir, full).split(path.sep).join("/"),
        size: data.byteLength,
        sha256: createHash("sha256").update(data).digest("hex"),
        data: data.toString("base64"),
      });
    }
  };
  await walk(dir);
  return files;
}

function isFork(type: ExtensionPackageType, siteId: string, manifest: Record<string, unknown>): boolean {
  const installed = typeof manifest.installedPath === "string" ? manifest.installedPath : "";
  const forks = siteThemesDir(siteId);
  return type === "theme" && Boolean(installed && forks && path.resolve(installed).startsWith(path.resolve(forks) + path.sep));
}

/** The site's own separate database, decrypted for the encrypted archive. */
async function siteDatabase(siteId: string): Promise<PortableDatabaseConnection | null> {
  const control = await getControlDb();
  const rows = await control.query<Row>(
    "SELECT driver, host, port, database_name, username, password_ciphertext FROM tenant_databases WHERE site_id = ? AND mode = 'separate' LIMIT 1",
    [siteId],
  );
  const row = rows[0];
  if (!row) return null;
  const engine = String(row.driver);
  return {
    driver: engine === "mysql" || engine === "mariadb" ? engine : "postgres",
    host: String(row.host ?? ""),
    port: Number(row.port) || 0,
    database: String(row.database_name ?? ""),
    username: String(row.username ?? ""),
    password: decryptSecret(row.password_ciphertext),
  };
}

async function siteHostnames(siteId: string): Promise<SiteHostname[]> {
  const control = await getControlDb();
  const rows = await control.query<{ hostname: string; is_primary: boolean | number; kind: string }>(
    "SELECT hostname, is_primary, kind FROM site_domains WHERE site_id = ? ORDER BY hostname ASC",
    [siteId],
  );
  return rows
    .map((row) => ({
      hostname: String(row.hostname),
      primary: row.is_primary === true || Number(row.is_primary) === 1,
      kind: String(row.kind ?? "custom"),
    }))
    .sort((a, b) => Number(b.primary) - Number(a.primary));
}

/**
 * Read a complete snapshot of one site from its authoritative database (the
 * caller selects it). Core tables come from one transaction. Secrets are
 * decrypted into portable markers; the caller encrypts the whole archive.
 */
export async function exportSiteData(
  db: DbClient,
  siteId: string,
  options: Options & {
    installationRoot?: boolean;
    /**
     * A snapshot taken just before a restore, to put back after a failure.
     * Package archives are not needed: the packages are installed here already.
     */
    rollbackSnapshot?: boolean;
  } = {},
): Promise<SiteExport> {
  checkCancelled(options.signal);
  const engine = driver();
  const snapshot = await db.transaction(async (tx) => {
    const siteColumns = (await tableColumns(tx, "sites", engine)) ?? [];
    const site = decodeJsonColumns(await tx.query<Row>(`SELECT ${selectColumns(siteColumns, engine)} FROM sites x WHERE x.id = ? LIMIT 1`, [siteId]), siteColumns)[0];
    if (!site) throw new Error("Site not found");
    const tables: Record<string, Row[]> = {};
    for (const table of SITE_TABLES) tables[table] = await readTable(tx, table, siteId, engine);
    const pluginTables: PortablePluginTable[] = [];
    for (const plugin of tables.plugins ?? []) {
      pluginTables.push(
        ...(await readPluginTables(tx, String(plugin.plugin_id), siteId, engine, false, options.installationRoot === true)),
      );
    }
    return { site: portableRow(site), tables, pluginTables };
  });
  for (const plugin of snapshot.tables.plugins ?? []) {
    snapshot.pluginTables.push(...(await readRemotePluginTables(String(plugin.plugin_id), siteId)));
  }
  checkCancelled(options.signal);

  const control = await getControlDb();
  const quotaColumns = (await tableColumns(control, "quota_limits", engine)) ?? [];
  const quotaLimits = decodeJsonColumns(
    await control.query<Row>("SELECT * FROM quota_limits WHERE scope = 'site' AND scope_id = ?", [siteId]),
    quotaColumns,
  ).map(portableRow);

  const packages: SiteExport["packages"] = [];
  const refs: PortableBackupData["packages"] = [];
  const themeFiles: PortableThemeFile[] = [];
  const themeBudget = { files: 0, bytes: 0 };
  const kinds: Array<["plugins" | "themes" | "css_providers", ExtensionPackageType, string]> = [
    ["plugins", "plugin", "plugin_id"],
    ["themes", "theme", "theme_id"],
    ["css_providers", "css-provider", "provider_id"],
  ];
  for (const [table, type, idColumn] of kinds) {
    for (const row of snapshot.tables[table] ?? []) {
      const resolved = options.rollbackSnapshot
        ? { ref: isFork(type, siteId, parseJson(row.manifest)) ? ({ kind: "fork" } as const) : ({ kind: "builtin" } as const) }
        : await packageForRow(type, siteId, parseJson(row.manifest));
      refs.push({ table, rowId: String(row.id), ref: resolved.ref });
      if ("archive" in resolved && resolved.archive) packages.push(resolved.archive);
      if (resolved.ref.kind === "fork") themeFiles.push(...(await readThemeFork(siteId, String(row[idColumn]), themeBudget)));
    }
  }

  const store = getUploadStore();
  const files: PortableBackupData["files"] = [];
  const mediaRows = snapshot.tables.media ?? [];
  let mediaBytes = 0;
  options.progress?.(0, mediaRows.length);
  for (const [index, row] of mediaRows.entries()) {
    checkCancelled(options.signal);
    const key = String(row.storage_key ?? "");
    const bytes = isSafeUploadKey(key) && key.startsWith(`${siteId}/`) ? await store.read(key).catch(() => null) : null;
    if (!bytes) {
      if (row.trashed_at) continue;
      throw new Error(`Backup stopped because the media file ${String(row.filename ?? key)} is missing`);
    }
    mediaBytes += bytes.byteLength;
    if (mediaBytes > MAX_PORTABLE_MEDIA_BYTES) throw new Error("Media exceeds the backup size limit");
    files.push({
      key,
      mimeType: String(row.mime_type ?? "application/octet-stream"),
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      data: bytes.toString("base64"),
    });
    options.progress?.(index + 1, mediaRows.length);
  }

  const { readPrivateFile } = await import("../files/private-storage.js");
  const privateFiles: PortableBackupData["privateFiles"] = [];
  for (const row of snapshot.tables.private_files ?? []) {
    checkCancelled(options.signal);
    const owner = String(row.owner);
    const key = String(row.file_key);
    const bytes = await readPrivateFile(siteId, owner, key);
    if (!bytes) throw new Error(`Backup stopped because the private file ${key} is missing`);
    privateFiles.push({
      owner,
      key,
      contentType: String(row.content_type ?? "application/octet-stream"),
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      data: bytes.toString("base64"),
    });
  }

  const stats = { undecryptable: 0 };
  const data: PortableBackupData = {
    site: exportSecrets(snapshot.site, stats) as Row,
    tables: exportSecrets(snapshot.tables, stats) as Record<string, Row[]>,
    quotaLimits,
    pluginTables: exportSecrets(snapshot.pluginTables, stats) as PortablePluginTable[],
    packages: refs,
    files,
    privateFiles,
    themeFiles,
    database: await siteDatabase(siteId),
    undecryptableSecrets: 0,
    extensions: {
      plugins: (snapshot.tables.plugins ?? []).map((row) => ({ plugin_id: row.plugin_id, version: row.version, status: row.status })),
      themes: (snapshot.tables.themes ?? []).map((row) => ({ theme_id: row.theme_id, version: row.version, status: row.status })),
    },
  };
  data.undecryptableSecrets = stats.undecryptable;
  return { data, packages, hostnames: await siteHostnames(siteId) };
}
