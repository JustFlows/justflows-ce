import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PackageManifestSchema, type PackageManifest } from "./package-manifest.js";
import {
  ARCHIVE_LIMITS,
  ArchiveSafetyError,
  computeDigest,
  PackageRejectedError,
  resolveWithinDir,
  verifyDigest,
} from "./archive-safety.js";
import { extractJfpkg } from "./extract-jfpkg.js";

export type InstallSource = "upload" | "marketplace" | "local-link";

export interface InstallOptions {
  /** Base directory where packages are staged and installed */
  packagesDir: string;
  /** If provided, verify the archive against this SHA-256 digest */
  expectedDigest?: string;
  source?: InstallSource;
  /** Skip signature verification in dev mode */
  skipVerification?: boolean;
  /** Skip extension license validation (local development only) */
  skipLicenseCheck?: boolean;
  /**
   * Trust check, run while the package is still in staging.
   *
   * Callers used to verify the manifest after installFromBuffer() returned, by
   * which point the package had already been renamed into its final installed
   * location — so a package Justflows had just refused stayed on disk, and
   * nothing removed it. Throwing from here happens before the rename, and the
   * catch below deletes the staging directory on the way out.
   *
   * Also the right place for the manifest.type check: a caller expecting a
   * theme should not have a plugin installed for it before it can object.
   */
  verify?: (manifest: PackageManifest, digest: string) => void | Promise<void>;
}

export interface InstallResult {
  manifest: PackageManifest;
  installedPath: string;
  digest: string;
  source: InstallSource;
}

/**
 * Install a .jfpkg archive (tar.gz) into the packages directory.
 *
 * No npm install, no postinstall scripts, no TypeScript compilation ever runs.
 */
export class PackageInstaller {
  async installFromBuffer(
    archiveBuffer: Buffer,
    options: InstallOptions,
  ): Promise<InstallResult> {
    const source = options.source ?? "upload";

    if (archiveBuffer.byteLength > ARCHIVE_LIMITS.maxCompressedBytes) {
      throw new ArchiveSafetyError(
        `Archive exceeds ${ARCHIVE_LIMITS.maxCompressedBytes / 1024 / 1024} MB limit`,
      );
    }

    const digest = computeDigest(archiveBuffer);
    if (options.expectedDigest && !options.skipVerification) {
      verifyDigest(archiveBuffer, options.expectedDigest);
    }

    const stagingDir = path.join(options.packagesDir, ".staging", randomUUID());
    await fs.mkdir(stagingDir, { recursive: true });

    try {
      await extractJfpkg(archiveBuffer, stagingDir);

      const manifestPath = path.join(stagingDir, "justflows.json");
      let manifestRaw: unknown;
      try {
        const text = await fs.readFile(manifestPath, "utf-8");
        manifestRaw = JSON.parse(text);
      } catch {
        throw new ArchiveSafetyError("Missing or invalid justflows.json manifest");
      }

      const parsed = PackageManifestSchema.safeParse(manifestRaw);
      if (!parsed.success) {
        throw new ArchiveSafetyError(
          `Invalid manifest: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
        );
      }

      const manifest = parsed.data;

      // Before the rename, while the package is still confined to staging and
      // the catch below can still remove it. Wrapped so the caller can tell its
      // own refusal (a 400 the operator can act on) from an internal failure.
      if (options.verify) {
        try {
          await options.verify(manifest, digest);
        } catch (err) {
          throw new PackageRejectedError(
            err instanceof Error ? err.message : String(err),
            err,
          );
        }
      }

      // Manifest fields, so untrusted: resolveWithinDir confines the result to
      // packagesDir before anything destructive runs against it below.
      const finalDir = resolveWithinDir(
        options.packagesDir,
        `${manifest.type}s`,
        manifest.id,
        manifest.version,
      );
      await fs.mkdir(path.dirname(finalDir), { recursive: true });
      await fs.rm(finalDir, { recursive: true, force: true });
      await fs.rename(stagingDir, finalDir);

      return { manifest, installedPath: finalDir, digest, source };
    } catch (err) {
      await fs.rm(stagingDir, { recursive: true, force: true });
      throw err;
    }
  }

  async installFromPath(archivePath: string, options: InstallOptions): Promise<InstallResult> {
    const buf = await fs.readFile(archivePath);
    return this.installFromBuffer(buf, options);
  }
}
