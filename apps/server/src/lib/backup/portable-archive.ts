// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import type { PackageRef } from "./package-archives.js";

export const PORTABLE_BACKUP_FORMAT = "justflows-portable-backup";
export const PORTABLE_BACKUP_VERSION = 2;
export const MAX_PORTABLE_BACKUP_BYTES = 256 * 1024 * 1024;
export const MAX_PORTABLE_MEDIA_BYTES = 160 * 1024 * 1024;

type Row = Record<string, unknown>;

export interface PortableBackupFile {
  key: string;
  mimeType: string;
  size: number;
  sha256: string;
  data: string;
}

export interface PortablePrivateFile {
  owner: string;
  key: string;
  contentType: string;
  size: number;
  sha256: string;
  data: string;
}

export interface PortableThemeFile {
  themeId: string;
  /** Path inside the theme folder, with forward slashes. */
  path: string;
  size: number;
  sha256: string;
  data: string;
}

/** A plugin-owned table's rows for this site, from the site database or the plugin's own database. */
export interface PortablePluginTable {
  pluginId: string;
  table: string;
  /** True when the rows live in a database the plugin recorded for itself. */
  remote: boolean;
  /** False for a table without `site_id`; only the installation root carries those rows. */
  siteScoped: boolean;
  rows: Row[];
}

export interface PortableDatabaseConnection {
  driver: "postgres" | "mysql" | "mariadb";
  host: string;
  port: number;
  database: string;
  username: string;
  /** Plaintext inside the passphrase-encrypted archive. */
  password: string;
  ssl?: boolean;
}

export interface PortableBackupData {
  /** The site's own `sites` row. */
  site: Row;
  tables: Record<string, Row[]>;
  quotaLimits: Row[];
  pluginTables: PortablePluginTable[];
  /** Where each plugin, theme and CSS provider row's files come from, by row id. */
  packages: Array<{ table: "plugins" | "themes" | "css_providers"; rowId: string; ref: PackageRef }>;
  files: PortableBackupFile[];
  privateFiles: PortablePrivateFile[];
  themeFiles: PortableThemeFile[];
  /** The site's separate database, when it does not use the workspace database. */
  database: PortableDatabaseConnection | null;
  /** Secrets that could not be decrypted with the source's APP_SECRET and travel empty. */
  undecryptableSecrets: number;
  extensions: { plugins: Row[]; themes: Row[] };
}

export interface PortableBackupEnvelope {
  format: typeof PORTABLE_BACKUP_FORMAT;
  version: number;
  createdAt: string;
  source: {
    siteId: string;
    siteName: string;
    databaseDriver: "postgres" | "mysql" | "mariadb";
    coreVersion?: string;
  };
  integrity: { algorithm: "sha256"; data: string };
  data: PortableBackupData;
}

type IntegrityPayload = Pick<PortableBackupEnvelope, "createdAt" | "source" | "data">;

function digest(payload: IntegrityPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** Compress one site's snapshot with its checksum. Encryption happens around the whole container. */
export function createPortableBackup(
  input: Omit<PortableBackupEnvelope, "format" | "version" | "integrity">,
): Buffer {
  const envelope: PortableBackupEnvelope = {
    format: PORTABLE_BACKUP_FORMAT,
    version: PORTABLE_BACKUP_VERSION,
    ...input,
    integrity: { algorithm: "sha256", data: digest(input) },
  };
  const serialized = Buffer.from(JSON.stringify(envelope));
  if (serialized.byteLength > MAX_PORTABLE_BACKUP_BYTES) throw new Error("Backup contents exceed the size limit");
  return gzipSync(serialized, { level: 6 });
}

function checkFiles(files: Array<{ data: string; size: number; sha256: string }>, label: string): number {
  let bytes = 0;
  for (const file of files) {
    if (!file || typeof file.data !== "string") throw new Error(`Backup archive contains an invalid ${label} entry`);
    const decoded = Buffer.from(file.data, "base64");
    bytes += decoded.byteLength;
    if (decoded.byteLength !== file.size || createHash("sha256").update(decoded).digest("hex") !== file.sha256) {
      throw new Error(`Backup archive ${label} integrity check failed`);
    }
  }
  return bytes;
}

/**
 * Version 1 archives (Justflows 0.4) held fewer tables and no passwords. They
 * still restore: content and media come back, accounts and plugin data do not.
 */
function upgradeVersion1(data: Record<string, unknown>): PortableBackupData {
  const tables = { ...((data.tables ?? {}) as Record<string, Row[]>) };
  const site = tables.sites?.[0] ?? {};
  delete tables.sites;
  delete tables.users;
  const userColumns = ["author_id", "created_by", "uploaded_by", "updated_by", "user_id"];
  for (const rows of Object.values(tables)) {
    for (const row of rows) for (const column of userColumns) if (column in row) row[column] = null;
  }
  const extensions = (data.extensions ?? { plugins: [], themes: [] }) as PortableBackupData["extensions"];
  return {
    site,
    tables,
    quotaLimits: [],
    pluginTables: [],
    packages: [],
    files: (data.files ?? []) as PortableBackupFile[],
    privateFiles: [],
    themeFiles: [],
    database: null,
    undecryptableSecrets: 0,
    extensions,
  };
}

/** Decode and authenticate one site snapshot before any restore code can consume it. */
export function readPortableBackup(archive: Buffer): PortableBackupEnvelope {
  if (archive.byteLength > MAX_PORTABLE_BACKUP_BYTES) throw new Error("Backup archive exceeds the size limit");
  let parsed: unknown;
  try {
    parsed = JSON.parse(gunzipSync(archive, { maxOutputLength: MAX_PORTABLE_BACKUP_BYTES }).toString("utf8"));
  } catch {
    throw new Error("Backup archive is not valid compressed JSON");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Backup archive has no manifest");
  const envelope = parsed as Partial<PortableBackupEnvelope>;
  if (envelope.format !== PORTABLE_BACKUP_FORMAT || (envelope.version !== 1 && envelope.version !== 2)) {
    throw new Error("Backup archive format is not supported");
  }
  if (
    !envelope.createdAt ||
    !envelope.source ||
    !envelope.data ||
    envelope.integrity?.algorithm !== "sha256" ||
    envelope.integrity.data !== digest({ createdAt: envelope.createdAt, source: envelope.source, data: envelope.data })
  ) {
    throw new Error("Backup archive integrity check failed");
  }
  const data =
    envelope.version === 1 ? upgradeVersion1(envelope.data as unknown as Record<string, unknown>) : envelope.data;
  const mediaBytes = checkFiles(data.files ?? [], "media");
  if (mediaBytes > MAX_PORTABLE_MEDIA_BYTES) throw new Error("Backup archive media exceeds the size limit");
  checkFiles(data.privateFiles ?? [], "private file");
  checkFiles(data.themeFiles ?? [], "theme file");
  return { ...(envelope as PortableBackupEnvelope), data };
}
