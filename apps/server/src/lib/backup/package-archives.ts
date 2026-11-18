// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getJfRoot } from "../runtime/jf-root.js";
import { packagesInstalledDir, siteThemesDir } from "../extensions/packages-dir.js";
import { resolvePathUnderBase } from "../security/safe-path.js";
import {
  readInstalledPackageIdentity,
  recordInstalledPackageBaseline,
  type ExtensionPackageType,
} from "../security/extension-integrity.js";

const DIGEST = /^[a-f0-9]{64}$/;
const PACKAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

export interface RetainedPackageMeta {
  digest: string;
  type: ExtensionPackageType;
  id: string;
  version: string;
  source: "marketplace" | "upload";
  /** Marketplace signature over the digest, when the package came from the marketplace. */
  signature?: string;
}

/**
 * Where an extension row's files come from. A backup carries the original
 * package archive for `package`, so restore can verify it again; `fork` themes
 * are the site's own files; `bundled` ships with Justflows itself.
 */
export type PackageRef =
  | { kind: "package"; digest: string }
  | { kind: "fork" }
  | { kind: "bundled"; folder: string }
  | { kind: "builtin" };

function archivesDir(): string {
  return path.join(getJfRoot(), "storage", "package-archives");
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Keep the verified archive of an installed package, so a backup can carry the
 * exact bytes and a restore can check their digest and signature again. Never
 * fails the install that called it: the package is already in place.
 */
export async function retainPackageArchive(buffer: Buffer, meta: RetainedPackageMeta): Promise<void> {
  try {
    if (!DIGEST.test(meta.digest) || sha256(buffer) !== meta.digest) return;
    const dir = archivesDir();
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    for (const [name, data] of [
      [`${meta.digest}.jfpkg`, buffer],
      [`${meta.digest}.json`, Buffer.from(`${JSON.stringify(meta)}\n`)],
    ] as const) {
      const dest = resolvePathUnderBase(dir, name);
      const temp = resolvePathUnderBase(dir, `${name}.tmp`);
      if (!dest || !temp) return;
      await fsp.writeFile(temp, data, { mode: 0o600 });
      await fsp.rename(temp, dest);
    }
  } catch (error) {
    console.warn("[justflows] could not keep the package archive for backups:", JSON.stringify(error instanceof Error ? error.message : String(error)));
  }
}

/** A retained archive whose bytes still match its digest, or null. */
export async function readRetainedPackage(digest: string): Promise<{ buffer: Buffer; meta: RetainedPackageMeta } | null> {
  if (!DIGEST.test(digest)) return null;
  const dir = archivesDir();
  const archive = resolvePathUnderBase(dir, `${digest}.jfpkg`);
  const metaFile = resolvePathUnderBase(dir, `${digest}.json`);
  if (!archive || !metaFile) return null;
  try {
    const [buffer, metaText] = await Promise.all([fsp.readFile(archive), fsp.readFile(metaFile, "utf8")]);
    const meta = JSON.parse(metaText) as RetainedPackageMeta;
    if (sha256(buffer) !== digest || meta.digest !== digest) return null;
    return { buffer, meta };
  } catch {
    return null;
  }
}

function underDir(child: string, parent: string): boolean {
  const resolvedParent = path.resolve(parent);
  const resolved = path.resolve(child);
  return resolved.startsWith(resolvedParent + path.sep);
}

/**
 * Find the package archive behind an extension row. A package installed
 * before archives were kept is fetched once more from the marketplace, and
 * only accepted when its digest matches the one recorded at install.
 */
export async function packageForRow(
  type: ExtensionPackageType,
  siteId: string,
  manifest: Record<string, unknown>,
): Promise<{ ref: PackageRef; archive?: { buffer: Buffer; meta: RetainedPackageMeta } }> {
  const installedPath = typeof manifest.installedPath === "string" ? manifest.installedPath : "";
  const label = `${String(manifest.name ?? manifest.id ?? "An extension")} ${String(manifest.version ?? "")}`.trim();
  if (installedPath) {
    const forks = siteThemesDir(siteId);
    if (type === "theme" && forks && underDir(installedPath, forks)) return { ref: { kind: "fork" } };
    if (!underDir(installedPath, packagesInstalledDir())) {
      throw new Error(`${label} is installed outside the package folder, so it cannot be backed up`);
    }
    const identity = await readInstalledPackageIdentity(installedPath);
    if (!identity) throw new Error(`${label} has no integrity baseline. Reinstall it, then back up again.`);
    const retained = await readRetainedPackage(identity.archiveDigest);
    if (retained) return { ref: { kind: "package", digest: identity.archiveDigest }, archive: retained };
    if (type !== "css-provider") {
      try {
        const { downloadMarketplacePackage } = await import("../extensions/marketplace-package.js");
        const fetched = await downloadMarketplacePackage(type, identity.packageId, identity.version);
        if (sha256(fetched.buffer) === identity.archiveDigest) {
          const meta: RetainedPackageMeta = {
            digest: identity.archiveDigest,
            type,
            id: identity.packageId,
            version: identity.version,
            source: "marketplace",
            signature: fetched.signature || undefined,
          };
          await retainPackageArchive(fetched.buffer, meta);
          return { ref: { kind: "package", digest: identity.archiveDigest }, archive: { buffer: fetched.buffer, meta } };
        }
      } catch {
        /** Fall through to the actionable error below. */
      }
    }
    throw new Error(`The package file of ${label} is not kept on this server. Reinstall it once, then back up again.`);
  }
  const bundledPath = typeof manifest.bundledPath === "string" ? manifest.bundledPath : "";
  if (bundledPath) return { ref: { kind: "bundled", folder: path.basename(bundledPath) } };
  return { ref: { kind: "builtin" } };
}

/**
 * Install a package from a backup through the same trust checks as an upload
 * or a marketplace install. An identical package already installed and still
 * matching its baseline is reused.
 */
export async function installPackageFromBackup(meta: RetainedPackageMeta, buffer: Buffer): Promise<string> {
  if (sha256(buffer) !== meta.digest) throw new Error(`Backup package ${meta.id} does not match its digest`);
  if (!PACKAGE_ID.test(meta.id)) throw new Error("Backup package id is not valid");
  const kindDir = `${meta.type}s`;
  const candidates = [
    resolvePathUnderBase(packagesInstalledDir(), kindDir, meta.id, meta.version, meta.digest),
    resolvePathUnderBase(packagesInstalledDir(), kindDir, meta.id, meta.version, meta.digest.slice(0, 16)),
  ];
  for (const dir of candidates) {
    if (!dir || !fs.existsSync(dir)) continue;
    const identity = await readInstalledPackageIdentity(dir);
    if (identity?.archiveDigest !== meta.digest) continue;
    const { verifyInstalledDirectory } = await import("../security/extension-integrity.js");
    if ((await verifyInstalledDirectory(dir))?.status === "verified") return dir;
  }
  const { PackageInstaller } = await import("@justflows/installer");
  const { assertPackageIsTrusted } = await import("../extensions/package-trust.js");
  const { getJustflowsVersion } = await import("../runtime/version.js");
  const result = await new PackageInstaller().installFromBuffer(buffer, {
    packagesDir: packagesInstalledDir(),
    justflowsVersion: getJustflowsVersion(),
    source: meta.source === "marketplace" ? "marketplace" : "upload",
    revisioned: meta.type === "plugin",
    immutable: meta.type !== "plugin",
    verify: (manifest, digest) => {
      if (manifest.type !== meta.type || manifest.id !== meta.id) {
        throw new Error(`Backup package ${meta.id} does not contain the expected ${meta.type}`);
      }
      assertPackageIsTrusted(manifest as unknown as Record<string, unknown>, digest, {
        marketplaceSignature: meta.signature,
      });
    },
  });
  await recordInstalledPackageBaseline({
    packageDir: result.installedPath,
    packageId: result.manifest.id,
    packageType: meta.type,
    version: result.manifest.version,
    archiveDigest: result.digest,
  });
  await retainPackageArchive(buffer, meta);
  return result.installedPath;
}
