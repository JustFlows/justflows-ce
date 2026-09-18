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

/**
 * `unzip -Zl` prints one line per entry beginning with the ten-character
 * permission string, e.g. "lrwxrwxrwx  3.0 unx  9 bx stor …  link -> target".
 * The leading character is the type: 'l' marks a symlink. Reading it lets us
 * reject links before extraction, which a path-only check cannot do.
 */
function listZipEntriesUnzip(zipPath: string): { path: string; symlink: boolean }[] | null {
  const result = runZipTool("unzip", ["-Zl", zipPath]);
  if (result.status !== 0) return null;

  const entries: { path: string; symlink: boolean }[] = [];
  for (const raw of (result.stdout ?? "").split("\n")) {
    const match = raw.match(/^([a-z-])[rwxsStTl-]{9}\s+\S+\s+\S+\s+\d+\s+\S+\s+\S+\s+\S+\s+(.*)$/);
    if (!match) continue;
    const name = match[2]!.trim();
    if (!name) continue;
    // "link -> target" in the listing; the entry itself is the part before " -> ".
    entries.push({ path: name.split(" -> ")[0]!.trim(), symlink: match[1] === "l" });
  }
  return entries.length > 0 ? entries : null;
}

/**
 * `7z l -slt` emits one "Path = …" / "Attributes = …" block per entry. The
 * older `-ba` short listing was parsed by taking the last whitespace-separated
 * token, which silently truncated any filename containing a space — so
 * "../../ evil.js" validated as "evil.js" and passed.
 */
function listZipEntries7z(zipPath: string): { path: string; symlink: boolean }[] | null {
  const result = runZipTool("7z", ["l", "-slt", zipPath]);
  if (result.status !== 0) return null;

  const entries: { path: string; symlink: boolean }[] = [];
  let current: string | null = null;
  let attributes = "";

  const flush = () => {
    if (current) entries.push({ path: current, symlink: /(^|\s)l/i.test(attributes) || attributes.includes("l") });
    current = null;
    attributes = "";
  };

  for (const raw of (result.stdout ?? "").split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("Path = ")) {
      flush();
      current = line.slice("Path = ".length).trim();
    } else if (line.startsWith("Attributes = ")) {
      attributes = line.slice("Attributes = ".length).trim();
    }
  }
  flush();

  return entries.length > 0 ? entries : null;
}

function listZipEntries(zipPath: string): { path: string; symlink: boolean }[] {
  const fromUnzip = listZipEntriesUnzip(zipPath);
  if (fromUnzip) return fromUnzip;

  const from7z = listZipEntries7z(zipPath);
  if (from7z) return from7z;

  throw new ZipSafetyError(
    "Could not inspect zip archive — ensure 'unzip' or '7z' is available on your server.",
  );
}

/** Extract zip only after validating every entry path (zip-slip protection). */
export function extractZipSafely(zipPath: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });

  const entries = listZipEntries(zipPath);
  for (const entry of entries) {
    // A path-only check is not enough. Both unzip and 7z restore symlinks, so
    // an archive holding `web -> /var/www` plus `web/index.php` passes every
    // string test and still writes outside destDir.
    if (entry.symlink) {
      throw new ZipSafetyError(`Symbolic link rejected: ${entry.path}`);
    }
    assertSafeEntry(entry.path);
  }

  const attempts: [string, string[]][] = [
    // -: refuses to create anything outside the -d directory.
    ["unzip", ["-qo", "-:", zipPath, "-d", destDir]],
    // -snld disables symlink restoration; -y answers the overwrite prompt.
    ["7z", ["x", "-snld", zipPath, `-o${destDir}`, "-y"]],
  ];

  for (const [cmd, args] of attempts) {
    const result = runZipTool(cmd, args);
    if (result.status === 0) {
      assertNoSymlinksUnder(destDir);
      return;
    }
  }

  throw new ZipSafetyError(
    "Could not extract the zip file. Ensure the 'unzip' command is available on your server.",
  );
}

/**
 * Belt and braces: if an older extractor ignored the flags above and restored a
 * link anyway, remove it before the caller starts copying files through it.
 */
function assertNoSymlinksUnder(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      fs.rmSync(full, { force: true });
      throw new ZipSafetyError(`Symbolic link rejected after extraction: ${entry.name}`);
    }
    if (entry.isDirectory()) assertNoSymlinksUnder(full);
  }
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
