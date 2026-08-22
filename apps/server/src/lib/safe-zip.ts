import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export class ZipSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipSafetyError";
  }
}

function assertSafeEntry(entryPath: string): void {
  if (!entryPath || entryPath.endsWith("/")) return;

  if (path.isAbsolute(entryPath)) {
    throw new ZipSafetyError(`Absolute path rejected: ${entryPath}`);
  }

  const normalized = path.normalize(entryPath.replace(/\\/g, "/"));
  if (normalized.startsWith("../") || normalized.includes("/../")) {
    throw new ZipSafetyError(`Path traversal rejected: ${entryPath}`);
  }
}

/** Listing a full Justflows zip can exceed Node's 1 MB spawnSync default. */
const ZIP_STDIO_MAX_BUFFER = 32 * 1024 * 1024;

function runZipTool(cmd: string, args: string[]) {
  return spawnSync(cmd, args, {
    encoding: "utf-8",
    stdio: "pipe",
    maxBuffer: ZIP_STDIO_MAX_BUFFER,
  });
}

function listZipEntries(zipPath: string): string[] {
  const attempts: [string, string[]][] = [
    ["unzip", ["-Z1", zipPath]],
    ["7z", ["l", "-ba", zipPath]],
  ];

  const failures: string[] = [];
  for (const [cmd, args] of attempts) {
    const result = runZipTool(cmd, args);
    if (result.status !== 0) {
      const detail = (result.stderr || result.error?.message || `exit ${result.status ?? "null"}`).trim();
      failures.push(`${cmd}: ${detail.slice(0, 300)}`);
      continue;
    }

    const lines = (result.stdout ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (cmd === "7z") {
      return lines
        .map((line) => {
          const parts = line.split(/\s+/);
          return parts[parts.length - 1] ?? "";
        })
        .filter(Boolean);
    }

    return lines;
  }

  throw new ZipSafetyError(
    "Could not inspect zip archive — ensure 'unzip' or '7z' is available on your server." +
      (failures.length ? ` (${failures.join("; ")})` : ""),
  );
}

/** Extract zip only after validating every entry path (zip-slip protection). */
export function extractZipSafely(zipPath: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });

  const entries = listZipEntries(zipPath);
  for (const entry of entries) {
    assertSafeEntry(entry);
  }

  const attempts: [string, string[]][] = [
    ["unzip", ["-qo", zipPath, "-d", destDir]],
    ["7z", ["x", zipPath, `-o${destDir}`, "-y"]],
  ];

  for (const [cmd, args] of attempts) {
    const result = runZipTool(cmd, args);
    if (result.status === 0) return;
  }

  throw new ZipSafetyError(
    "Could not extract the zip file. Ensure the 'unzip' command is available on your server.",
  );
}

/** Ensure a relative destination path cannot escape the destination root. */
export function resolvePathUnderRoot(root: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    return null;
  }
  return resolved;
}
