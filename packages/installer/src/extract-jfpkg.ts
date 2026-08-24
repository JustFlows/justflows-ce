import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import fs from "node:fs/promises";
import path from "node:path";
import { ARCHIVE_LIMITS, ArchiveSafetyError, assertSafePath } from "./archive-safety.js";

/**
 * Inflate with a running ceiling. gunzipSync would materialise the whole stream
 * before any limit could be applied, so a 50 MB archive that expands to tens of
 * gigabytes exhausts memory before the check runs.
 */
async function gunzipBounded(archive: Buffer, maxBytes: number): Promise<Buffer> {
  const gunzip = createGunzip();
  const chunks: Buffer[] = [];
  let total = 0;

  const source = Readable.from(archive).pipe(gunzip);

  await new Promise<void>((resolve, reject) => {
    source.on("data", (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > maxBytes) {
        source.destroy();
        reject(new ArchiveSafetyError("Archive expanded size limit exceeded"));
        return;
      }
      chunks.push(chunk);
    });
    source.on("end", resolve);
    source.on("error", (err) =>
      reject(
        err instanceof ArchiveSafetyError
          ? err
          : new ArchiveSafetyError("Invalid gzip in .jfpkg archive"),
      ),
    );
  });

  return Buffer.concat(chunks);
}

function readCString(block: Buffer, start: number, length: number): string {
  const slice = block.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? length : end).toString("utf8").replace(/\0/g, "").trim();
}

/**
 * Extract a gzipped ustar .jfpkg using only Node builtins.
 * Avoids node-tar native addons, which crash Phusion Passenger on some hosts.
 */
export async function extractJfpkg(archive: Buffer, dest: string): Promise<void> {
  if (archive.length < 2 || archive[0] !== 0x1f || archive[1] !== 0x8b) {
    throw new ArchiveSafetyError("Not a gzip .jfpkg archive");
  }

  const tarBuf = await gunzipBounded(archive, ARCHIVE_LIMITS.maxExpandedBytes);

  if (tarBuf.byteLength / Math.max(archive.byteLength, 1) > ARCHIVE_LIMITS.maxDecompressionRatio) {
    throw new ArchiveSafetyError("Decompression ratio limit exceeded (possible bomb)");
  }

  let offset = 0;
  let fileCount = 0;
  let expandedBytes = 0;

  while (offset + 512 <= tarBuf.length) {
    const header = tarBuf.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = readCString(header, 0, 100);
    const prefix = readCString(header, 345, 155);
    const entryPath = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(readCString(header, 124, 12), 8) || 0;
    const typeFlag = String.fromCharCode(header[156] ?? 48);
    offset += 512;
    const content = tarBuf.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;

    if (!entryPath || entryPath === "." || entryPath === "./") continue;
    assertSafePath(entryPath, dest);

    const isDir = typeFlag === "5" || entryPath.endsWith("/");
    if (isDir) {
      await fs.mkdir(path.join(dest, entryPath), { recursive: true });
      continue;
    }
    if (typeFlag !== "0" && typeFlag !== "\0") {
      continue;
    }

    fileCount += 1;
    expandedBytes += content.byteLength;
    if (fileCount > ARCHIVE_LIMITS.maxFileCount) {
      throw new ArchiveSafetyError(`Archive exceeds ${ARCHIVE_LIMITS.maxFileCount} file limit`);
    }
    if (expandedBytes > ARCHIVE_LIMITS.maxExpandedBytes) {
      throw new ArchiveSafetyError("Archive expanded size limit exceeded");
    }

    const outPath = path.join(dest, entryPath);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, content);
  }
}
