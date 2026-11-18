// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import { readPortableBackup, type PortableBackupEnvelope } from "./portable-archive.js";
import type { RetainedPackageMeta } from "./package-archives.js";
import type { BackupKind } from "./archive-crypto.js";

/**
 * The plaintext inside an encrypted backup file.
 *
 * Layout: an 8-byte magic, a 4-byte big-endian manifest length, the JSON
 * manifest, then each site's compressed snapshot and each package archive back
 * to back. A package used by many sites is stored once. A single-site backup
 * is the same container with one site.
 */
export const CONTAINER_MAGIC = Buffer.from("JFBKCTR2", "ascii");
export const CONTAINER_FORMAT = "justflows-backup";
export const CONTAINER_VERSION = 2;
export const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
export const MAX_BACKUP_SITES = 101;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const HEADER_BYTES = CONTAINER_MAGIC.byteLength + 4;

export interface SiteHostname {
  hostname: string;
  primary: boolean;
  kind: string;
}

export interface ExtensionUse {
  id: string;
  version: string;
  sites: string[];
}

interface Segment {
  offset: number;
  length: number;
  sha256: string;
}

export interface ContainerSiteEntry extends Segment {
  siteId: string;
  siteName: string;
  root: boolean;
  hostnames: SiteHostname[];
}

export interface ContainerPackageEntry extends Segment, RetainedPackageMeta {}

/** Installation-wide state, carried only by a network backup of the root site's workspace. */
export interface InstallationSnapshot {
  tenant: { name: string; slug: string; userMode: string };
  platformSettings: Array<Record<string, unknown>>;
  platformOperators: string[];
}

export interface BackupManifest {
  format: typeof CONTAINER_FORMAT;
  version: typeof CONTAINER_VERSION;
  kind: BackupKind;
  createdAt: string;
  source: {
    siteId: string;
    siteName: string;
    databaseDriver: "postgres" | "mysql" | "mariadb";
    coreVersion?: string;
  };
  installation: InstallationSnapshot | null;
  sites: ContainerSiteEntry[];
  packages: ContainerPackageEntry[];
  extensions: { plugins: ExtensionUse[]; themes: ExtensionUse[] };
  integrity: { algorithm: "sha256"; manifest: string };
}

export interface ContainerSiteInput {
  siteId: string;
  siteName: string;
  root: boolean;
  hostnames: SiteHostname[];
  archive: Buffer;
  extensions?: { plugins: Record<string, unknown>[]; themes: Record<string, unknown>[] };
}

type UnsignedManifest = Omit<BackupManifest, "integrity">;

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function manifestDigest(manifest: UnsignedManifest): string {
  const { format, version, kind, createdAt, source, installation, sites, packages, extensions } = manifest;
  return sha256(JSON.stringify({ format, version, kind, createdAt, source, installation, sites, packages, extensions }));
}

function inventory(sites: ContainerSiteInput[], kind: "plugins" | "themes", idColumn: string): ExtensionUse[] {
  const byKey = new Map<string, ExtensionUse>();
  for (const site of sites) {
    for (const row of site.extensions?.[kind] ?? []) {
      const id = String(row[idColumn] ?? "");
      if (!id) continue;
      const version = String(row.version ?? "");
      const entry = byKey.get(`${id}@${version}`) ?? { id, version, sites: [] };
      if (!entry.sites.includes(site.siteId)) entry.sites.push(site.siteId);
      byKey.set(`${id}@${version}`, entry);
    }
  }
  return [...byKey.values()].sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version));
}

/** Bundle site snapshots and the package archives they need. */
export function createBackupContainer(input: {
  kind: BackupKind;
  createdAt: string;
  databaseDriver: "postgres" | "mysql" | "mariadb";
  coreVersion?: string;
  installation: InstallationSnapshot | null;
  sites: ContainerSiteInput[];
  packages: Array<{ meta: RetainedPackageMeta; buffer: Buffer }>;
}): Buffer {
  const first = input.sites[0];
  if (!first) throw new Error("A backup needs at least one site");
  if (input.kind === "site" && input.sites.length !== 1) throw new Error("A site backup holds exactly one site");
  if (input.kind === "network" && (!first.root || input.sites.slice(1).some((site) => site.root))) {
    throw new Error("A network backup needs the root site first and exactly once");
  }
  if (input.sites.length > MAX_BACKUP_SITES) throw new Error("A network backup is limited to 100 subsites");
  let offset = 0;
  const segment = (buffer: Buffer): Segment => {
    const entry = { offset, length: buffer.byteLength, sha256: sha256(buffer) };
    offset += buffer.byteLength;
    return entry;
  };
  const sites = input.sites.map((site) => ({
    siteId: site.siteId,
    siteName: site.siteName,
    root: site.root,
    hostnames: site.hostnames,
    ...segment(site.archive),
  }));
  const unique = new Map(input.packages.map((item) => [item.meta.digest, item]));
  const packages = [...unique.values()].map((item) => ({ ...item.meta, ...segment(item.buffer) }));
  const unsigned: UnsignedManifest = {
    format: CONTAINER_FORMAT,
    version: CONTAINER_VERSION,
    kind: input.kind,
    createdAt: input.createdAt,
    source: { siteId: first.siteId, siteName: first.siteName, databaseDriver: input.databaseDriver, coreVersion: input.coreVersion },
    installation: input.installation,
    sites,
    packages,
    extensions: {
      plugins: inventory(input.sites, "plugins", "plugin_id"),
      themes: inventory(input.sites, "themes", "theme_id"),
    },
  };
  const manifest = Buffer.from(JSON.stringify({ ...unsigned, integrity: { algorithm: "sha256", manifest: manifestDigest(unsigned) } }));
  if (manifest.byteLength > MAX_MANIFEST_BYTES) throw new Error("Backup manifest is too large");
  const total = HEADER_BYTES + manifest.byteLength + offset;
  if (total > MAX_BACKUP_BYTES) throw new Error("The backup exceeds the 512 MB limit");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(manifest.byteLength, 0);
  return Buffer.concat(
    [CONTAINER_MAGIC, length, manifest, ...input.sites.map((site) => site.archive), ...[...unique.values()].map((item) => item.buffer)],
    total,
  );
}

export interface BackupReader {
  manifest: BackupManifest;
  /** Decode and authenticate one site snapshot; drop it before reading the next. */
  readSite(entry: ContainerSiteEntry): PortableBackupEnvelope;
  packageBytes(digest: string): Buffer;
}

function validSegment(entry: Segment | undefined, expectedOffset: number): boolean {
  return Boolean(
    entry &&
      Number.isSafeInteger(entry.offset) &&
      Number.isSafeInteger(entry.length) &&
      entry.length > 0 &&
      entry.offset === expectedOffset &&
      typeof entry.sha256 === "string",
  );
}

/**
 * Check the manifest and every segment's bounds and digest. Site contents are
 * decoded lazily, one at a time, so a large network is never held decoded.
 */
export function openBackupContainer(container: Buffer): BackupReader {
  if (container.byteLength > MAX_BACKUP_BYTES) throw new Error("The backup exceeds the 512 MB limit");
  if (container.byteLength < HEADER_BYTES || !container.subarray(0, 8).equals(CONTAINER_MAGIC)) {
    throw new Error("The backup contents are not a Justflows backup");
  }
  const manifestLength = container.readUInt32BE(8);
  if (manifestLength === 0 || manifestLength > MAX_MANIFEST_BYTES || HEADER_BYTES + manifestLength > container.byteLength) {
    throw new Error("Backup manifest is invalid");
  }
  let parsed: Partial<BackupManifest>;
  try {
    parsed = JSON.parse(container.subarray(HEADER_BYTES, HEADER_BYTES + manifestLength).toString("utf8")) as Partial<BackupManifest>;
  } catch {
    throw new Error("Backup manifest is invalid");
  }
  if (parsed.format !== CONTAINER_FORMAT || parsed.version !== CONTAINER_VERSION) throw new Error("Backup format is not supported");
  if (
    (parsed.kind !== "site" && parsed.kind !== "network") ||
    typeof parsed.createdAt !== "string" ||
    !parsed.source ||
    !Array.isArray(parsed.sites) ||
    !Array.isArray(parsed.packages) ||
    !parsed.extensions ||
    parsed.integrity?.algorithm !== "sha256" ||
    parsed.integrity.manifest !== manifestDigest(parsed as UnsignedManifest)
  ) {
    throw new Error("Backup integrity check failed");
  }
  const manifest = parsed as BackupManifest;
  const { sites, packages } = manifest;
  if (sites.length === 0 || sites.length > MAX_BACKUP_SITES || (manifest.kind === "site" && sites.length !== 1)) {
    throw new Error("Backup has an invalid number of sites");
  }
  const seen = new Set<string>();
  let expected = 0;
  for (const [index, entry] of sites.entries()) {
    if (
      !validSegment(entry, expected) ||
      typeof entry.siteId !== "string" ||
      !entry.siteId ||
      typeof entry.siteName !== "string" ||
      typeof entry.root !== "boolean" ||
      (manifest.kind === "network" && entry.root !== (index === 0)) ||
      !Array.isArray(entry.hostnames) ||
      entry.hostnames.length > 50 ||
      seen.has(entry.siteId)
    ) {
      throw new Error("Backup site list is invalid");
    }
    seen.add(entry.siteId);
    expected += entry.length;
  }
  const digests = new Set<string>();
  for (const entry of packages) {
    if (!validSegment(entry, expected) || !/^[a-f0-9]{64}$/.test(entry.digest) || digests.has(entry.digest)) {
      throw new Error("Backup package list is invalid");
    }
    digests.add(entry.digest);
    expected += entry.length;
  }
  const dataStart = HEADER_BYTES + manifestLength;
  if (dataStart + expected !== container.byteLength) throw new Error("The backup is truncated or has extra data");
  const slice = (entry: Segment): Buffer => container.subarray(dataStart + entry.offset, dataStart + entry.offset + entry.length);
  for (const entry of [...sites, ...packages]) {
    if (sha256(slice(entry)) !== entry.sha256) throw new Error("Backup integrity check failed");
  }
  for (const entry of packages) {
    if (sha256(slice(entry)) !== entry.digest) throw new Error("Backup package does not match its digest");
  }
  const byDigest = new Map(packages.map((entry) => [entry.digest, entry]));
  return {
    manifest,
    readSite(entry) {
      const envelope = readPortableBackup(slice(entry));
      if (envelope.source.siteId !== entry.siteId) throw new Error("Backup site does not match its manifest");
      return envelope;
    },
    packageBytes(digest) {
      const entry = byDigest.get(digest);
      if (!entry) throw new Error("Backup is missing a package it refers to");
      return slice(entry);
    },
  };
}
