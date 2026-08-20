import fs from "node:fs";
import path from "node:path";
import { getJfRoot } from "./jf-root.js";
import type { BlockNode } from "./types.js";

export function themesDir(): string {
  return path.join(getJfRoot(), "themes");
}

export function packagesDir(): string {
  const rel = process.env.PACKAGES_DIR ?? "packages-installed";
  return path.isAbsolute(rel) ? rel : path.join(getJfRoot(), rel);
}

/** Map theme id (e.g. justflows.default) to folder slug (default). */
export function themeSlugFromId(themeId: string): string {
  const parts = themeId.split(".");
  return parts[parts.length - 1] ?? themeId;
}

function isThemePackageDir(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "justflows-theme.json")) ||
    fs.existsSync(path.join(dir, "justflows.json"))
  );
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
  const root = path.join(packagesDir(), "themes", themeId);
  if (!fs.existsSync(root)) return null;
  if (isThemePackageDir(root)) return root;

  const versions = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersions)
    .reverse();

  for (const version of versions) {
    const dir = path.join(root, version);
    if (isThemePackageDir(dir)) return dir;
  }
  return null;
}

export function resolveThemeDir(themeId: string, installedPath?: string | null): string | null {
  if (installedPath && isThemePackageDir(installedPath)) return installedPath;

  const installed = latestInstalledThemeDir(themeId);
  if (installed) return installed;

  const slug = themeSlugFromId(themeId);
  const bundled = path.join(themesDir(), slug);
  if (isThemePackageDir(bundled)) return bundled;

  if (themeId === "justflows.default") {
    const fallback = path.join(themesDir(), "default");
    if (isThemePackageDir(fallback)) return fallback;
  }

  return null;
}

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
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

  const stylesDir = path.join(dir, "styles");
  if (!fs.existsSync(stylesDir)) return "";

  return ["global.css", "components.css", "blocks.css"]
    .map((name) => path.join(stylesDir, name))
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n\n");
}

export interface ThemePatternMeta {
  id: string;
  title: string;
  description?: string;
  category?: string;
}

export interface ThemePattern extends ThemePatternMeta {
  blocks: BlockNode[];
}

function patternsDir(themeId: string, installedPath?: string | null): string | null {
  const dir = resolveThemeDir(themeId, installedPath);
  if (!dir) return null;
  const patterns = path.join(dir, "patterns");
  return fs.existsSync(patterns) ? patterns : null;
}

export function listThemePatterns(themeId: string, installedPath?: string | null): ThemePatternMeta[] {
  const dir = patternsDir(themeId, installedPath);
  if (!dir) return [];

  const results: ThemePatternMeta[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const data = readJsonFile<ThemePatternMeta>(path.join(dir, name));
    if (!data?.id) continue;
    results.push({
      id: data.id,
      title: data.title ?? data.id,
      description: data.description,
      category: data.category ?? "pages",
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
  const file = path.join(dir, `${safeId}.json`);
  const data = readJsonFile<ThemePattern>(file);
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

  const demoFile = path.join(dir, "demo", "home.json");
  const data = readJsonFile<{ blocks?: BlockNode[] }>(demoFile);
  if (!data?.blocks || !Array.isArray(data.blocks)) return null;
  return data.blocks;
}
