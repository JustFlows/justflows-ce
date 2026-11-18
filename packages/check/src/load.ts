// SPDX-License-Identifier: MIT

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SDK_VERSION } from "@justflows/sdk";
import type { CheckTarget, ManifestShape, PackageFile, PackageType } from "./types.js";

const MAX_FILES = 5000;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const SKIPPED_SOURCE_DIRS = new Set(["node_modules", ".git", ".turbo", "coverage"]);

function readJson(file: string): { value: Record<string, unknown> | null; error: string | null } {
  if (!fs.existsSync(file)) return { value: null, error: null };
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { value: parsed as Record<string, unknown>, error: null }
      : { value: null, error: "is not a JSON object" };
  } catch (error) {
    return { value: null, error: `is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function walk(root: string, mode: CheckTarget["mode"]): { files: PackageFile[]; skipped: number } {
  const files: PackageFile[] = [];
  let skipped = 0;
  const visit = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (mode === "source" && SKIPPED_SOURCE_DIRS.has(entry.name)) {
          skipped += 1;
          continue;
        }
        visit(full, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= MAX_FILES) throw new Error(`The package has more than ${MAX_FILES} files`);
      const size = fs.statSync(full).size;
      let cached: Buffer | null = null;
      const read = () => (cached ??= fs.readFileSync(full));
      files.push({ path: rel, size, read, text: () => (size > MAX_TEXT_BYTES ? "" : read().toString("utf8")) });
    }
  };
  visit(root, "");
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skipped };
}

/** The Justflows version of the checkout this checker belongs to, when it can be found. */
function bundledCoreVersion(): string | null {
  try {
    const file = new URL("../../../package.json", import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as { name?: string; version?: string };
    return pkg.name === "justflows" && pkg.version ? pkg.version : null;
  } catch {
    return null;
  }
}

function packageType(manifest: ManifestShape | null, themeManifest: ManifestShape | null): PackageType | null {
  const type = manifest?.type;
  if (type === "plugin" || type === "theme" || type === "css-provider") return type;
  return themeManifest ? "theme" : null;
}

export interface LoadedTarget {
  target: CheckTarget;
  /** Removes the temporary copy of an extracted .jfpkg. */
  dispose(): Promise<void>;
}

/** Read a package folder or a .jfpkg archive (extracted with the installer's bounded extractor). */
export async function loadTarget(
  input: string,
  options: {
    coreVersion?: string | null | undefined;
    /** Treat a folder as an unpacked package (an installed extension), not an author's source. */
    asPackage?: boolean | undefined;
  } = {},
): Promise<LoadedTarget> {
  const absolute = path.resolve(input);
  const stat = await fsp.stat(absolute).catch(() => null);
  if (!stat) throw new Error(`${input} does not exist`);
  let root = absolute;
  let mode: CheckTarget["mode"] = options.asPackage ? "package" : "source";
  let cleanup: string | null = null;
  if (stat.isFile()) {
    if (!/\.(jfpkg|zip)$/i.test(absolute)) throw new Error("Check a package folder or a .jfpkg file");
    const { ARCHIVE_LIMITS, extractJfpkg } = await import("@justflows/installer");
    const archive = await fsp.readFile(absolute);
    if (archive.byteLength > ARCHIVE_LIMITS.maxCompressedBytes) {
      throw new Error(`The archive exceeds the ${ARCHIVE_LIMITS.maxCompressedBytes / 1024 / 1024} MB install limit`);
    }
    cleanup = await fsp.mkdtemp(path.join(os.tmpdir(), "justflows-check-"));
    try {
      await extractJfpkg(archive, cleanup);
    } catch (error) {
      await fsp.rm(cleanup, { recursive: true, force: true });
      throw new Error(`The archive cannot be installed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    root = cleanup;
    mode = "package";
  }
  const manifest = readJson(path.join(root, "justflows.json"));
  const themeManifest = readJson(path.join(root, "justflows-theme.json"));
  const packageJson = readJson(path.join(root, "package.json"));
  const { files, skipped } = walk(root, mode);
  const target: CheckTarget = {
    root,
    mode,
    files,
    skippedDependencyFiles: skipped,
    manifest: manifest.value,
    manifestError: manifest.value ? null : manifest.error ?? "is missing",
    type: packageType(manifest.value, themeManifest.value),
    themeManifest: themeManifest.value,
    packageJson: packageJson.value,
    coreVersion: options.coreVersion === undefined ? bundledCoreVersion() : options.coreVersion,
    sdkVersion: SDK_VERSION,
  };
  return {
    target,
    dispose: async () => {
      if (cleanup) await fsp.rm(cleanup, { recursive: true, force: true });
    },
  };
}
