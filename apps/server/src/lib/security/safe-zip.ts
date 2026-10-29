// SPDX-License-Identifier: MIT

import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";

export class ZipSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipSafetyError";
  }
}

/** Listing a full Justflows zip can exceed Node's default pipe comfort. */
const ZIP_STDIO_MAX_BUFFER = 32 * 1024 * 1024;
const ZIP_TIMEOUT_MS = 30_000;

interface ZipToolResult {
  status: number | null;
  stdout: string;
  timedOut: boolean;
}

interface ZipEntry {
  path: string;
  kind: "file" | "dir" | "special";
}

/**
 * Run unzip or 7z off the request thread and kill it if it does not finish.
 * spawnSync would block the process for the whole listing.
 */
function runZipTool(cmd: string, args: string[]): Promise<ZipToolResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    const out: Buffer[] = [];
    let outLen = 0;
    let settled = false;
    const finish = (result: ZipToolResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ status: null, stdout: "", timedOut: true });
    }, ZIP_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => {
      outLen += chunk.length;
      if (outLen > ZIP_STDIO_MAX_BUFFER) {
        child.kill("SIGKILL");
        finish({ status: null, stdout: "", timedOut: true });
        return;
      }
      out.push(chunk);
    });
    child.on("error", () => finish({ status: null, stdout: "", timedOut: false }));
    child.on("close", (status) => {
      finish({ status, stdout: Buffer.concat(out).toString("utf8"), timedOut: false });
    });
  });
}

function assertSafeEntry(entryPath: string): void {
  if (!entryPath || entryPath.includes("\0") || entryPath.startsWith("-")) {
    throw new ZipSafetyError("Archive entry path is not allowed");
  }
  const normalized = entryPath.replace(/\\/g, "/");
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(entryPath)) {
    throw new ZipSafetyError("Absolute path rejected");
  }
  const parts = normalized.replace(/\/+$/, "").split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new ZipSafetyError("Path traversal rejected");
  }
}

function remember(entries: ZipEntry[], entry: ZipEntry): void {
  assertSafeEntry(entry.path);
  const key = entry.path.replace(/\\/g, "/").replace(/\/+$/, "");
  for (const existing of entries) {
    const other = existing.path;
    const fileIsPrefix =
      (existing.kind === "file" && key.startsWith(`${other}/`))
      || (entry.kind === "file" && other.startsWith(`${key}/`));
    if (other === key || fileIsPrefix) throw new ZipSafetyError("Conflicting archive entry");
  }
  if (entry.kind === "special") throw new ZipSafetyError("Unsupported archive entry");
  entries.push({ path: key, kind: entry.kind });
}

/**
 * `unzip -Zl` prints one line per entry. A line that looks like an entry but
 * does not parse is a partial listing, and that fails closed.
 */
function parseUnzipListing(stdout: string): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let sawEntry = false;
  for (const raw of stdout.split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    const match = line.match(/^([a-z-])[rwxsStTl-]{9}\s+\S+\s+\S+\s+\d+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.*)$/);
    const looksLikeEntry = /^[a-z-][rwxsStTl-]{9}\s/.test(line);
    if (!match) {
      if (looksLikeEntry) throw new ZipSafetyError("Could not read the archive listing");
      continue;
    }
    sawEntry = true;
    const name = match[2]!.split(" -> ")[0]!.trim();
    const type = match[1]!;
    const kind = type === "-" ? "file" : type === "d" ? "dir" : "special";
    remember(entries, { path: name, kind });
  }
  if (!sawEntry) throw new ZipSafetyError("Could not read the archive listing");
  return entries;
}

function parse7zListing(stdout: string, zipPath: string): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let current: string | null = null;
  let attributes: string | null = null;
  const flush = () => {
    if (!current) return;
    if (path.resolve(current) === path.resolve(zipPath)) {
      current = null;
      attributes = null;
      return;
    }
    if (attributes === null) throw new ZipSafetyError("Could not read the archive listing");
    const unix = attributes.split(/\s+/).find((part) => /^[dlcbps-][rwxstST-]{9}$/.test(part));
    let kind: ZipEntry["kind"] = "special";
    if (unix?.startsWith("-") || attributes === "A") kind = "file";
    else if (unix?.startsWith("d") || attributes === "D" || attributes.startsWith("D_")) kind = "dir";
    else if (!unix && attributes === "") kind = "file";
    remember(entries, { path: current, kind });
    current = null;
    attributes = null;
  };
  for (const raw of stdout.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("Path = ")) {
      flush();
      current = line.slice("Path = ".length).trim();
    } else if (line.startsWith("Attributes = ")) {
      attributes = line.slice("Attributes = ".length).trim();
    }
  }
  flush();
  if (entries.length === 0) throw new ZipSafetyError("Could not read the archive listing");
  return entries;
}

async function listZipEntries(zipPath: string): Promise<{ entries: ZipEntry[]; tool: "unzip" | "7z" }> {
  const unzip = await runZipTool("unzip", ["-Zl", zipPath]);
  if (unzip.timedOut) throw new ZipSafetyError("Archive processing timed out");
  if (unzip.status === 0 && unzip.stdout.trim()) {
    const names = await runZipTool("unzip", ["-Z1", zipPath]);
    if (names.timedOut) throw new ZipSafetyError("Archive processing timed out");
    if (names.status !== 0) throw new ZipSafetyError("Could not read the archive listing");
    const entries = parseUnzipListing(unzip.stdout);
    const listed = names.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    if (listed.length !== entries.length) throw new ZipSafetyError("Could not read the archive listing");
    return { entries, tool: "unzip" };
  }

  const seven = await runZipTool("7z", ["l", "-slt", zipPath]);
  if (seven.timedOut) throw new ZipSafetyError("Archive processing timed out");
  if (seven.status === 0 && seven.stdout.includes("Path = ")) {
    return { entries: parse7zListing(seven.stdout, zipPath), tool: "7z" };
  }
  throw new ZipSafetyError("Could not inspect zip archive — ensure 'unzip' or '7z' is available on your server.");
}

async function assertContained(destDir: string, entries: ZipEntry[]): Promise<void> {
  const root = await fsp.realpath(destDir);
  const expect = new Set(entries.filter((entry) => entry.kind === "file").map((entry) => entry.path));
  const found = new Set<string>();
  const walk = async (dir: string) => {
    for (const name of await fsp.readdir(dir)) {
      const full = path.join(dir, name);
      const stat = await fsp.lstat(full);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        throw new ZipSafetyError("Unsupported archive entry");
      }
      const real = await fsp.realpath(full);
      if (real !== root && !real.startsWith(root + path.sep)) {
        throw new ZipSafetyError("Path traversal rejected");
      }
      if (stat.isDirectory()) await walk(full);
      else found.add(path.relative(root, real).split(path.sep).join("/"));
    }
  };
  await walk(root);
  for (const name of expect) {
    if (!found.has(name)) throw new ZipSafetyError("Could not extract the zip file");
  }
}

/** Extract zip only after every entry has been classified. */
export async function extractZipSafely(zipPath: string, destDir: string): Promise<void> {
  const { entries, tool } = await listZipEntries(zipPath);
  await fsp.mkdir(destDir, { recursive: true });
  const attempts: [string, string[]][] = tool === "unzip"
    ? [["unzip", ["-qo", "-:", zipPath, "-d", destDir]]]
    : [["7z", ["x", "-snld", zipPath, `-o${destDir}`, "-y"]]];
  for (const [cmd, args] of attempts) {
    const result = await runZipTool(cmd, args);
    if (result.timedOut) throw new ZipSafetyError("Archive processing timed out");
    if (result.status === 0) {
      await assertContained(destDir, entries);
      return;
    }
  }
  throw new ZipSafetyError("Could not extract the zip file. Ensure the 'unzip' command is available on your server.");
}

function corePackageJson(entries: ZipEntry[]): string {
  const files = new Set(entries.filter((entry) => entry.kind === "file").map((entry) => entry.path));
  if (files.has("package.json") && files.has("server.js")) return "package.json";
  for (const name of files) {
    const match = /^([^/]+)\/package\.json$/.exec(name);
    if (match && files.has(`${match[1]}/server.js`)) return name;
  }
  throw new ZipSafetyError("Invalid update package — missing package.json");
}

/**
 * Read the core package version from a zip without extracting it.
 * The entry must already be a normal file inside the archive.
 */
export async function readZipPackageVersion(zipPath: string): Promise<string> {
  const { entries, tool } = await listZipEntries(zipPath);
  const entry = corePackageJson(entries);
  const result = tool === "unzip"
    ? await runZipTool("unzip", ["-p", zipPath, entry])
    : await runZipTool("7z", ["e", "-so", zipPath, entry]);
  if (result.timedOut) throw new ZipSafetyError("Archive processing timed out");
  if (result.status !== 0) throw new ZipSafetyError("Could not read the archive");
  if (result.stdout.length > 1_000_000) throw new ZipSafetyError("Archive entry is too large");
  let parsed: { name?: string; version?: string };
  try {
    parsed = JSON.parse(result.stdout) as { name?: string; version?: string };
  } catch {
    throw new ZipSafetyError("Invalid package.json in archive");
  }
  if (parsed.name && parsed.name !== "justflows") throw new ZipSafetyError("Invalid update package");
  const version = parsed.version?.trim() ?? "";
  if (!version) throw new ZipSafetyError("Archive package.json has no version");
  return version;
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
