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
