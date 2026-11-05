// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

export const PORTABLE_BACKUP_FORMAT = "justflows-portable-backup";
export const PORTABLE_BACKUP_VERSION = 1;
export const MAX_PORTABLE_BACKUP_BYTES = 256 * 1024 * 1024;
export const MAX_PORTABLE_MEDIA_BYTES = 160 * 1024 * 1024;

export interface PortableBackupFile {
  key: string;
  mimeType: string;
  size: number;
  sha256: string;
  data: string;
}

export interface PortableBackupData {
  tables: Record<string, Record<string, unknown>[]>;
  extensions: {
    plugins: Record<string, unknown>[];
    themes: Record<string, unknown>[];
  };
  files: PortableBackupFile[];
}

export interface PortableBackupEnvelope {
  format: typeof PORTABLE_BACKUP_FORMAT;
  version: typeof PORTABLE_BACKUP_VERSION;
  createdAt: string;
  source: {
    siteId: string;
    siteName: string;
    databaseDriver: "postgres" | "mysql" | "mariadb";
    coreVersion?: string;
  };
  integrity: {
    algorithm: "sha256";
    data: string;
  };
  data: PortableBackupData;
}

type IntegrityPayload = Pick<PortableBackupEnvelope, "createdAt" | "source" | "data">;

function canonicalPayload(payload: IntegrityPayload): string {
  return JSON.stringify(payload);
}

function digest(payload: IntegrityPayload): string {
  return createHash("sha256").update(canonicalPayload(payload)).digest("hex");
}

/** Create a compressed archive after its caller has removed authentication secrets. */
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
  if (serialized.byteLength > MAX_PORTABLE_BACKUP_BYTES)
    throw new Error("Backup contents exceed the size limit");
  return gzipSync(serialized, { level: 9 });
}

/** Decode and authenticate an archive before any restore code can consume it. */
export function readPortableBackup(archive: Buffer): PortableBackupEnvelope {
  if (archive.byteLength > MAX_PORTABLE_BACKUP_BYTES)
    throw new Error("Backup archive exceeds the size limit");
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      gunzipSync(archive, { maxOutputLength: MAX_PORTABLE_BACKUP_BYTES }).toString("utf8"),
    );
  } catch {
    throw new Error("Backup archive is not valid compressed JSON");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Backup archive has no manifest");
  const envelope = parsed as Partial<PortableBackupEnvelope>;
  if (envelope.format !== PORTABLE_BACKUP_FORMAT || envelope.version !== PORTABLE_BACKUP_VERSION) {
    throw new Error("Backup archive format is not supported");
  }
  if (
    !envelope.createdAt ||
    !envelope.source ||
    !envelope.data ||
    envelope.integrity?.algorithm !== "sha256" ||
    envelope.integrity.data !==
      digest({ createdAt: envelope.createdAt, source: envelope.source, data: envelope.data })
  ) {
    throw new Error("Backup archive integrity check failed");
  }
  let mediaBytes = 0;
  for (const file of envelope.data.files ?? []) {
    if (!file || typeof file.key !== "string" || typeof file.data !== "string") {
      throw new Error("Backup archive contains an invalid media entry");
    }
    const bytes = Buffer.from(file.data, "base64");
    mediaBytes += bytes.byteLength;
    if (
      bytes.byteLength !== file.size ||
      createHash("sha256").update(bytes).digest("hex") !== file.sha256 ||
      mediaBytes > MAX_PORTABLE_MEDIA_BYTES
    ) {
      throw new Error("Backup archive media integrity check failed");
    }
  }
  return envelope as PortableBackupEnvelope;
}
