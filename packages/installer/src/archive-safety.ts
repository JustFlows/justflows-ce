import { createHash } from "node:crypto";
import path from "node:path";

/** Limits that protect against decompression bombs and path traversal */
export const ARCHIVE_LIMITS = {
  maxCompressedBytes: 50 * 1024 * 1024,   // 50 MB
  maxExpandedBytes: 200 * 1024 * 1024,    // 200 MB
  maxFileCount: 2_000,
  maxDecompressionRatio: 20,
} as const;

export class ArchiveSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveSafetyError";
  }
}

/**
 * The caller's own trust check refused this package.
 *
 * Distinct from ArchiveSafetyError so a route can answer 400 with the reason —
 * a type mismatch or an unsigned package is the operator's problem to fix, and
 * assertPackageIsTrusted's message explains how. Anything else escaping the
 * installer is ours, and stays a 500.
 */
export class PackageRejectedError extends Error {
  constructor(message: string, cause?: unknown) {
    // Native Error.cause rather than a parameter property, so the original
    // error survives for the log without shadowing the base class member.
    super(message, { cause });
    this.name = "PackageRejectedError";
  }
}

/**
 * Validate an entry path is safe: no path traversal, no absolute paths,
 * no symlink escapes.
 */
export function assertSafePath(entryPath: string, stagingRoot: string): void {
  if (path.isAbsolute(entryPath)) {
    throw new ArchiveSafetyError(`Absolute path rejected: ${entryPath}`);
  }

  const resolved = path.resolve(stagingRoot, entryPath);
  if (!resolved.startsWith(stagingRoot + path.sep) && resolved !== stagingRoot) {
    throw new ArchiveSafetyError(`Path traversal rejected: ${entryPath}`);
  }
}

/**
 * Resolve `segments` under `baseDir`, refusing anything that escapes it.
 *
 * The install destination is built out of manifest fields, and a manifest is
 * attacker-controlled input. `version` was validated by a regex anchored only
 * at the start, so "1.0.0/../../../.." passed the schema and path.join() walked
 * straight out of packagesDir — into an fs.rm() and then an fs.rename().
 * Tightening the schema is the first line of defence; this is the one that does
 * not depend on every future regex staying anchored.
 *
 * Each segment must be a single path component: `path.resolve` would happily
 * absorb a separator, and a rejected segment is a clearer error than a
 * containment failure two frames later.
 */
export function resolveWithinDir(baseDir: string, ...segments: string[]): string {
  const base = path.resolve(baseDir);

  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      throw new ArchiveSafetyError(`Invalid path segment: "${segment}"`);
    }
    if (/[/\\\0]/.test(segment)) {
      throw new ArchiveSafetyError(`Path separators are not allowed in "${segment}"`);
    }
  }

  const resolved = path.resolve(base, ...segments);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new ArchiveSafetyError(`Resolved path escapes the packages directory: ${resolved}`);
  }

  return resolved;
}

/** Verify SHA-256 digest of a buffer matches an expected hex string */
export function verifyDigest(data: Buffer, expectedHex: string): void {
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== expectedHex) {
    throw new ArchiveSafetyError(
      `Digest mismatch: expected ${expectedHex}, got ${actual}`,
    );
  }
}

/** Compute SHA-256 digest of a buffer */
export function computeDigest(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
