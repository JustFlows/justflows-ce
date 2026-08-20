import fs from "node:fs";
import path from "node:path";

/** Resolve a path and ensure it stays inside baseDir (blocks traversal and symlink escapes). */
export function resolvePathUnderBase(baseDir: string, ...segments: string[]): string | null {
  const base = path.resolve(baseDir);
  const candidate = path.resolve(base, ...segments);

  if (candidate !== base && !candidate.startsWith(base + path.sep)) {
    return null;
  }

  let realBase = base;
  try {
    realBase = fs.realpathSync(base);
  } catch {
    // base may not exist yet
  }

  let realCandidate = candidate;
  try {
    realCandidate = fs.realpathSync(candidate);
  } catch {
    // file may not exist yet — compare resolved paths instead
    if (candidate !== realBase && !candidate.startsWith(realBase + path.sep)) {
      return null;
    }
    return candidate;
  }

  if (realCandidate !== realBase && !realCandidate.startsWith(realBase + path.sep)) {
    return null;
  }

  return candidate;
}

/** Only compiled JavaScript entrypoints may be dynamically imported. */
export function isSafePluginEntry(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".js" && ext !== ".mjs" && ext !== ".cjs") return false;
  if (filePath.includes(`${path.sep}node_modules${path.sep}`)) return false;
  return true;
}
