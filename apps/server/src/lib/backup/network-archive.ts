// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import { readPortableBackup, type PortableBackupEnvelope } from "./portable-archive.js";

/**
 * A network archive bundles the root site and every subsite of its workspace.
 *
 * Layout: an 8-byte magic, a 4-byte big-endian manifest length, the JSON
 * manifest, then each site's ordinary portable `.jfbackup` archive back to
 * back. Site archives keep their own checksums, so a network archive never
 * needs a second compression pass or base64 copy of the media.
 */
export const NETWORK_BACKUP_MAGIC = Buffer.from("JFNETBK1", "ascii");
export const NETWORK_BACKUP_FORMAT = "justflows-network-backup";
export const NETWORK_BACKUP_VERSION = 1;
export const MAX_NETWORK_BACKUP_BYTES = 512 * 1024 * 1024;
export const MAX_NETWORK_SITES = 101;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const HEADER_BYTES = NETWORK_BACKUP_MAGIC.byteLength + 4;

export interface NetworkSiteHostname {
  hostname: string;
  primary: boolean;
}

export interface NetworkExtensionUse {
  id: string;
  version: string;
  /** Source site ids that have this extension installed, in archive order. */
  sites: string[];
}

export interface NetworkSiteEntry {
  siteId: string;
  siteName: string;
  root: boolean;
  hostnames: NetworkSiteHostname[];
  offset: number;
  length: number;
  sha256: string;
}

export interface NetworkBackupManifest {
  format: typeof NETWORK_BACKUP_FORMAT;
  version: typeof NETWORK_BACKUP_VERSION;
  createdAt: string;
  source: {
    rootSiteId: string;
    rootSiteName: string;
    databaseDriver: "postgres" | "mysql" | "mariadb";
    coreVersion?: string;
  };
  sites: NetworkSiteEntry[];
  /** One deduplicated inventory, so a package shared by many sites is listed once. */
  extensions: { plugins: NetworkExtensionUse[]; themes: NetworkExtensionUse[] };
  integrity: { algorithm: "sha256"; manifest: string };
}

export interface NetworkSiteInput {
  siteId: string;
  siteName: string;
  root: boolean;
  hostnames: NetworkSiteHostname[];
  archive: Buffer;
  extensions?: { plugins: Record<string, unknown>[]; themes: Record<string, unknown>[] };
}

type UnsignedManifest = Omit<NetworkBackupManifest, "integrity">;

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function manifestDigest(manifest: UnsignedManifest): string {
  return sha256(
    JSON.stringify({
      format: manifest.format,
      version: manifest.version,
      createdAt: manifest.createdAt,
      source: manifest.source,
      sites: manifest.sites,
      extensions: manifest.extensions,
    }),
  );
}

function inventory(
  sites: NetworkSiteInput[],
  kind: "plugins" | "themes",
  idColumn: "plugin_id" | "theme_id",
): NetworkExtensionUse[] {
  const byKey = new Map<string, NetworkExtensionUse>();
  for (const site of sites) {
    for (const row of site.extensions?.[kind] ?? []) {
      const id = String(row[idColumn] ?? "");
      if (!id) continue;
      const version = String(row.version ?? "");
      const key = `${id}@${version}`;
      const entry = byKey.get(key) ?? { id, version, sites: [] };
      if (!entry.sites.includes(site.siteId)) entry.sites.push(site.siteId);
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()].sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version));
}

/** Bundle already-built site archives; the root site must come first. */
export function createNetworkBackup(input: {
  createdAt: string;
  databaseDriver: "postgres" | "mysql" | "mariadb";
  coreVersion?: string;
  sites: NetworkSiteInput[];
}): Buffer {
  const root = input.sites[0];
  if (!root?.root || input.sites.slice(1).some((site) => site.root)) {
    throw new Error("A network backup needs the root site first and exactly once");
  }
  if (input.sites.length > MAX_NETWORK_SITES) throw new Error("Network backup is limited to 100 subsites");
  let offset = 0;
  const sites: NetworkSiteEntry[] = input.sites.map((site) => {
    const entry: NetworkSiteEntry = {
      siteId: site.siteId,
      siteName: site.siteName,
      root: site.root,
      hostnames: site.hostnames,
      offset,
      length: site.archive.byteLength,
      sha256: sha256(site.archive),
    };
    offset += site.archive.byteLength;
    return entry;
  });
  const unsigned: UnsignedManifest = {
    format: NETWORK_BACKUP_FORMAT,
    version: NETWORK_BACKUP_VERSION,
    createdAt: input.createdAt,
    source: {
      rootSiteId: root.siteId,
      rootSiteName: root.siteName,
      databaseDriver: input.databaseDriver,
      coreVersion: input.coreVersion,
    },
    sites,
    extensions: {
      plugins: inventory(input.sites, "plugins", "plugin_id"),
      themes: inventory(input.sites, "themes", "theme_id"),
    },
  };
  const manifest = Buffer.from(
    JSON.stringify({ ...unsigned, integrity: { algorithm: "sha256", manifest: manifestDigest(unsigned) } }),
  );
  if (manifest.byteLength > MAX_MANIFEST_BYTES) throw new Error("Network backup manifest is too large");
  const total = HEADER_BYTES + manifest.byteLength + offset;
  if (total > MAX_NETWORK_BACKUP_BYTES) throw new Error("Network backup exceeds the 512 MB limit");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(manifest.byteLength, 0);
  return Buffer.concat([NETWORK_BACKUP_MAGIC, length, manifest, ...input.sites.map((site) => site.archive)], total);
}

/** True when the bytes start with the network archive magic. */
export function isNetworkBackup(archive: Buffer): boolean {
  return (
    archive.byteLength >= HEADER_BYTES &&
    archive.subarray(0, NETWORK_BACKUP_MAGIC.byteLength).equals(NETWORK_BACKUP_MAGIC)
  );
}

function isHostnameList(value: unknown): value is NetworkSiteHostname[] {
  return (
    Array.isArray(value) &&
    value.length <= 50 &&
    value.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as NetworkSiteHostname).hostname === "string" &&
        typeof (item as NetworkSiteHostname).primary === "boolean",
    )
  );
}

export interface NetworkBackupReader {
  manifest: NetworkBackupManifest;
  /** The raw portable archive of one site, already checked against the manifest digest. */
  siteArchive(entry: NetworkSiteEntry): Buffer;
  /** Decode and authenticate one site archive; the caller drops it before reading the next. */
  readSite(entry: NetworkSiteEntry): PortableBackupEnvelope;
}

/**
 * Parse the header and manifest, then check every site archive's bounds and
 * digest. Site contents are decoded lazily by `readSite`, one at a time, so
 * validating a large network never holds every decompressed site at once.
 */
export function openNetworkBackup(archive: Buffer): NetworkBackupReader {
  if (archive.byteLength > MAX_NETWORK_BACKUP_BYTES) throw new Error("Network backup exceeds the 512 MB limit");
  if (!isNetworkBackup(archive)) throw new Error("This is not a network backup archive");
  const manifestLength = archive.readUInt32BE(NETWORK_BACKUP_MAGIC.byteLength);
  if (manifestLength === 0 || manifestLength > MAX_MANIFEST_BYTES || HEADER_BYTES + manifestLength > archive.byteLength) {
    throw new Error("Network backup manifest is invalid");
  }
  let parsed: Partial<NetworkBackupManifest>;
  try {
    parsed = JSON.parse(archive.subarray(HEADER_BYTES, HEADER_BYTES + manifestLength).toString("utf8")) as Partial<NetworkBackupManifest>;
  } catch {
    throw new Error("Network backup manifest is invalid");
  }
  if (parsed.format !== NETWORK_BACKUP_FORMAT || parsed.version !== NETWORK_BACKUP_VERSION) {
    throw new Error("Network backup format is not supported");
  }
  if (
    typeof parsed.createdAt !== "string" ||
    !parsed.source ||
    typeof parsed.source.rootSiteId !== "string" ||
    !Array.isArray(parsed.sites) ||
    !parsed.extensions ||
    !Array.isArray(parsed.extensions.plugins) ||
    !Array.isArray(parsed.extensions.themes) ||
    parsed.integrity?.algorithm !== "sha256" ||
    parsed.integrity.manifest !== manifestDigest(parsed as UnsignedManifest)
  ) {
    throw new Error("Network backup integrity check failed");
  }
  const manifest = parsed as NetworkBackupManifest;
  const sites = manifest.sites;
  if (sites.length === 0 || sites.length > MAX_NETWORK_SITES) throw new Error("Network backup has an invalid number of sites");
  const dataStart = HEADER_BYTES + manifestLength;
  const seen = new Set<string>();
  let expectedOffset = 0;
  for (const [index, entry] of sites.entries()) {
    if (
      !entry ||
      typeof entry.siteId !== "string" ||
      !entry.siteId ||
      typeof entry.siteName !== "string" ||
      typeof entry.root !== "boolean" ||
      entry.root !== (index === 0) ||
      !isHostnameList(entry.hostnames) ||
      !Number.isSafeInteger(entry.offset) ||
      !Number.isSafeInteger(entry.length) ||
      entry.length <= 0 ||
      entry.offset !== expectedOffset ||
      typeof entry.sha256 !== "string"
    ) {
      throw new Error("Network backup site list is invalid");
    }
    if (seen.has(entry.siteId)) throw new Error("Network backup lists a site twice");
    seen.add(entry.siteId);
    expectedOffset += entry.length;
  }
  if (sites[0]?.siteId !== manifest.source.rootSiteId) throw new Error("Network backup root site does not match");
  if (dataStart + expectedOffset !== archive.byteLength) throw new Error("Network backup is truncated or has extra data");
  const slice = (entry: NetworkSiteEntry): Buffer => archive.subarray(dataStart + entry.offset, dataStart + entry.offset + entry.length);
  for (const entry of sites) {
    if (sha256(slice(entry)) !== entry.sha256) throw new Error(`Network backup integrity check failed for ${entry.siteName}`);
  }
  return {
    manifest,
    siteArchive: slice,
    readSite(entry) {
      const envelope = readPortableBackup(slice(entry));
      if (envelope.source.siteId !== entry.siteId) throw new Error("Network backup site does not match its manifest");
      return envelope;
    },
  };
}
