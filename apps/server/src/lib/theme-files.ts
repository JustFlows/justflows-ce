import fs from "node:fs";
import path from "node:path";
import { getJfRoot } from "./jf-root.js";
import { resolvePathUnderBase } from "./safe-path.js";
import type { BlockNode } from "./types.js";

const THEME_ID_RE = /^[a-z0-9][a-z0-9._-]{0,120}$/i;

export function themesDir(): string {
  return path.join(getJfRoot(), "themes");
}

export function packagesDir(): string {
  const rel = process.env.PACKAGES_DIR ?? "packages-installed";
  return path.isAbsolute(rel) ? rel : path.join(getJfRoot(), rel);
}

function safeThemeId(themeId: string): string | null {
  const id = themeId.trim();
  if (!THEME_ID_RE.test(id) || id.includes("..")) return null;
  return id;
}

/** Map theme id (e.g. justflows.default) to folder slug (default). */
export function themeSlugFromId(themeId: string): string {
  const parts = themeId.split(".");
  return parts[parts.length - 1] ?? themeId;
}

function themeDirUnderKnownRoots(dir: string): string | null {
  const resolved = path.resolve(dir);
  for (const root of [packagesDir(), themesDir()]) {
    const rel = path.relative(root, resolved);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    const trusted = resolvePathUnderBase(root, rel);
    if (trusted) return trusted;
  }
  return null;
}

function isThemePackageDir(dir: string): boolean {
  const manifest = resolvePathUnderBase(dir, "justflows-theme.json");
  const legacy = resolvePathUnderBase(dir, "justflows.json");
  return Boolean((manifest && fs.existsSync(manifest)) || (legacy && fs.existsSync(legacy)));
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function latestInstalledThemeDir(themeId: string): string | null {
  const id = safeThemeId(themeId);
  if (!id) return null;
  const themesRoot = resolvePathUnderBase(packagesDir(), "themes");
  if (!themesRoot) return null;
  const root = resolvePathUnderBase(themesRoot, id);
  if (!root) return null;
  try {
    if (!fs.statSync(root).isDirectory()) return null;
  } catch {
    return null;
  }
  if (isThemePackageDir(root)) return root;

  let versions: string[];
  try {
    versions = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareVersions)
      .reverse();
  } catch {
    return null;
  }

  for (const version of versions) {
    if (!THEME_ID_RE.test(version) || version.includes("..")) continue;
    const dir = resolvePathUnderBase(root, version);
    if (dir && isThemePackageDir(dir)) return dir;
  }
  return null;
}

export function resolveThemeDir(themeId: string, installedPath?: string | null): string | null {
  if (installedPath) {
    const trusted = themeDirUnderKnownRoots(installedPath);
    if (trusted && isThemePackageDir(trusted)) return trusted;
  }

  const installed = latestInstalledThemeDir(themeId);
  if (installed) return installed;

  const id = safeThemeId(themeId);
  if (!id) return null;

  const slug = themeSlugFromId(id);
  if (!THEME_ID_RE.test(slug) || slug.includes("..")) return null;
  const bundled = resolvePathUnderBase(themesDir(), slug);
  if (bundled && isThemePackageDir(bundled)) return bundled;

  if (id === "justflows.default") {
    const fallback = resolvePathUnderBase(themesDir(), "default");
    if (fallback && isThemePackageDir(fallback)) return fallback;
  }

  return null;
}

function readJsonFile<T>(baseDir: string, ...segments: string[]): T | null {
  const filePath = resolvePathUnderBase(baseDir, ...segments);
  if (!filePath) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Concatenate theme stylesheets (global.css, components.css, blocks.css). */
export function loadThemeStyles(themeId: string, installedPath?: string | null): string {
  const dir = resolveThemeDir(themeId, installedPath);
  if (!dir) return "";

  const stylesDir = resolvePathUnderBase(dir, "styles");
  if (!stylesDir) return "";
  try {
    if (!fs.statSync(stylesDir).isDirectory()) return "";
  } catch {
    return "";
  }

  return ["global.css", "components.css", "blocks.css"]
    .map((name) => resolvePathUnderBase(stylesDir, name))
    .filter((file): file is string => Boolean(file))
    .map((file) => {
      try {
        return fs.readFileSync(file, "utf8");
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

export interface ThemePatternMeta {
  id: string;
  title: string;
  description?: string;
  category?: string;
  /** Block types this pattern uses that come from a plugin rather than core. */
  requiresBlockTypes?: string[];
}

export interface ThemePattern extends ThemePatternMeta {
  blocks: BlockNode[];
}

function patternsDir(themeId: string, installedPath?: string | null): string | null {
  const dir = resolveThemeDir(themeId, installedPath);
  if (!dir) return null;
  const patterns = resolvePathUnderBase(dir, "patterns");
  if (!patterns) return null;
  try {
    return fs.statSync(patterns).isDirectory() ? patterns : null;
  } catch {
    return null;
  }
}

export function listThemePatterns(themeId: string, installedPath?: string | null): ThemePatternMeta[] {
  const dir = patternsDir(themeId, installedPath);
  if (!dir) return [];

  const results: ThemePatternMeta[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const data = readJsonFile<ThemePatternMeta>(dir, name);
    if (!data?.id) continue;
    results.push({
      id: data.id,
      title: data.title ?? data.id,
      description: data.description,
      category: data.category ?? "pages",
      requiresBlockTypes: Array.isArray(data.requiresBlockTypes) ? data.requiresBlockTypes : undefined,
    });
  }
  return results;
}

export function loadThemePattern(
  themeId: string,
  patternId: string,
  installedPath?: string | null,
): ThemePattern | null {
  const dir = patternsDir(themeId, installedPath);
  if (!dir) return null;

  const safeId = patternId.replace(/[^a-z0-9_-]/gi, "");
  if (!safeId) return null;
  const data = readJsonFile<ThemePattern>(dir, `${safeId}.json`);
  if (!data?.blocks || !Array.isArray(data.blocks)) return null;

  return {
    id: data.id ?? safeId,
    title: data.title ?? safeId,
    description: data.description,
    category: data.category,
    blocks: data.blocks,
  };
}

export function loadThemeDemoHome(themeId: string, installedPath?: string | null): BlockNode[] | null {
  const dir = resolveThemeDir(themeId, installedPath);
  if (!dir) return null;

  const data = readJsonFile<{ blocks?: BlockNode[] }>(dir, "demo", "home.json");
  if (!data?.blocks || !Array.isArray(data.blocks)) return null;
  return data.blocks;
}

export function loadThemeDemoBlog(themeId: string, installedPath?: string | null): BlockNode[] | null {
  const dir = resolveThemeDir(themeId, installedPath);
  if (!dir) return null;

  const data = readJsonFile<{ blocks?: BlockNode[] }>(dir, "demo", "blog.json");
  if (!data?.blocks || !Array.isArray(data.blocks)) return null;
  return data.blocks;
}
