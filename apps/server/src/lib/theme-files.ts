import fs from "node:fs";
import path from "node:path";
import { getJfRoot } from "./jf-root.js";
import { resolvePathUnderBase } from "./safe-path.js";
import type { BlockNode } from "./types.js";
import type { TemplatePartSlot } from "./template-hierarchy.js";
import {
  BlockPatternSchema,
  ThemePatternRegistrationSchema,
  type BlockPattern,
} from "@justflows/sdk";
import { sanitizeBlockDocument } from "@justflows/blocks";

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
  version: string;
  source: "theme";
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

function patternRegistrations(dir: string): Map<string, string> | null {
  const manifest =
    readJsonFile<Record<string, unknown>>(dir, "justflows-theme.json") ??
    readJsonFile<Record<string, unknown>>(dir, "justflows.json");
  if (!manifest || !("patterns" in manifest)) return null;
  if (
    !manifest.patterns ||
    typeof manifest.patterns !== "object" ||
    Array.isArray(manifest.patterns)
  )
    return new Map();
  const registrations = new Map<string, string>();
  for (const [id, raw] of Object.entries(manifest.patterns as Record<string, unknown>)) {
    const parsed = ThemePatternRegistrationSchema.safeParse(raw);
    if (!parsed.success) continue;
    registrations.set(id, typeof parsed.data === "string" ? parsed.data : parsed.data.path);
  }
  return registrations;
}

function localizedPattern(pattern: BlockPattern, locale?: string): BlockPattern {
  if (!locale || !pattern.locales) return pattern;
  const exact = pattern.locales[locale];
  const base = pattern.locales[locale.split("-")[0] ?? ""];
  const value = exact ?? base;
  return value ? { ...pattern, ...value } : pattern;
}

function readPattern(dir: string, fileName: string, locale?: string): BlockPattern | null {
  const raw = readJsonFile<Record<string, unknown>>(dir, fileName);
  if (!raw) return null;
  const parsed = BlockPatternSchema.safeParse(raw);
  if (!parsed.success) return null;
  const localized = localizedPattern(parsed.data, locale);
  return {
    ...localized,
    blocks: sanitizeBlockDocument({ version: 1, blocks: localized.blocks })
      .blocks as BlockPattern["blocks"],
  };
}

export function listThemePatterns(
  themeId: string,
  installedPath?: string | null,
  locale?: string,
): ThemePatternMeta[] {
  const dir = patternsDir(themeId, installedPath);
  if (!dir) return [];

  const results: ThemePatternMeta[] = [];
  const registrations = patternRegistrations(path.dirname(dir));
  const files = registrations
    ? [...registrations.entries()].map(([id, file]) => [id, path.basename(file)] as const)
    : fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => [name.slice(0, -5), name] as const);
  for (const [registeredId, name] of files) {
    const data = readPattern(dir, name, locale);
    if (!data || data.id !== registeredId) continue;
    results.push({
      id: data.id,
      title: data.title ?? data.id,
      description: data.description,
      category: data.category ?? "pages",
      requiresBlockTypes:
        Array.isArray(data.requiresBlockTypes) && data.requiresBlockTypes.length > 0
          ? data.requiresBlockTypes
          : undefined,
      version: data.version,
      source: "theme",
    });
  }
  return results.sort(
    (a, b) =>
      (a.category ?? "sections").localeCompare(b.category ?? "sections") ||
      a.title.localeCompare(b.title),
  );
}

export function loadThemePattern(
  themeId: string,
  patternId: string,
  installedPath?: string | null,
  locale?: string,
): ThemePattern | null {
  const dir = patternsDir(themeId, installedPath);
  if (!dir) return null;

  const safeId = patternId.replace(/[^a-z0-9_-]/gi, "");
  if (!safeId) return null;
  const registrations = patternRegistrations(path.dirname(dir));
  const registeredPath = registrations?.get(safeId);
  if (registrations && !registeredPath) return null;
  const data = readPattern(
    dir,
    registeredPath ? path.basename(registeredPath) : `${safeId}.json`,
    locale,
  );
  if (!data || data.id !== safeId) return null;

  return {
    id: data.id ?? safeId,
    title: data.title ?? safeId,
    description: data.description,
    category: data.category,
    requiresBlockTypes: data.requiresBlockTypes.length > 0 ? data.requiresBlockTypes : undefined,
    version: data.version,
    source: "theme",
    blocks: data.blocks,
  };
}

// --- Template hierarchy (WordPress-style templates + parts) ---------------

const TEMPLATE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

function themeSubdir(
  themeId: string,
  subdir: "templates" | "parts",
  installedPath?: string | null,
): string | null {
  const dir = resolveThemeDir(themeId, installedPath);
  if (!dir) return null;
  const sub = resolvePathUnderBase(dir, subdir);
  if (!sub) return null;
  try {
    return fs.statSync(sub).isDirectory() ? sub : null;
  } catch {
    return null;
  }
}

function readBlockDocFile(dir: string, name: string): BlockNode[] | null {
  const data = readJsonFile<{ blocks?: BlockNode[] }>(dir, name);
  if (!data?.blocks || !Array.isArray(data.blocks)) return null;
  return data.blocks;
}

/**
 * A theme template body (`templates/<slug>.json`), or `null` when the theme
 * ships no file for that slug. `demo/home.json` and `demo/blog.json` still
 * answer for the `front-page` / `home` slots so v1 themes keep working while
 * they migrate to `templates/`.
 */
export function loadThemeTemplate(
  themeId: string,
  slug: string,
  installedPath?: string | null,
): BlockNode[] | null {
  if (!TEMPLATE_SLUG_RE.test(slug)) return null;
  const dir = themeSubdir(themeId, "templates", installedPath);
  if (dir) {
    const blocks = readBlockDocFile(dir, `${slug}.json`);
    if (blocks) return blocks;
  }
  if (slug === "front-page") return loadThemeDemoHome(themeId, installedPath);
  if (slug === "home") return loadThemeDemoBlog(themeId, installedPath);
  return null;
}

/** The template slugs a theme actually ships a file for (`templates/*.json`). */
export function listThemeTemplateSlugs(themeId: string, installedPath?: string | null): string[] {
  const dir = themeSubdir(themeId, "templates", installedPath);
  if (!dir) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .filter((slug) => TEMPLATE_SLUG_RE.test(slug))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Walk an ordered candidate list (from {@link templateCandidates}) and return
 * the first template the theme provides, with the slug that matched.
 */
export function resolveThemeTemplate(
  themeId: string,
  candidates: string[],
  installedPath?: string | null,
): { slug: string; blocks: BlockNode[] } | null {
  for (const slug of candidates) {
    const blocks = loadThemeTemplate(themeId, slug, installedPath);
    if (blocks) return { slug, blocks };
  }
  return null;
}

/**
 * A theme template part (`parts/<slug>.json`), or `null`. `footer` falls back
 * to the legacy `demo/footer.json`; `header` chrome stays config-shaped and is
 * handled by {@link loadThemeDemoHeader}, not here.
 */
export function loadThemeTemplatePart(
  themeId: string,
  slug: TemplatePartSlot,
  installedPath?: string | null,
): BlockNode[] | null {
  const dir = themeSubdir(themeId, "parts", installedPath);
  if (dir) {
    const blocks = readBlockDocFile(dir, `${slug}.json`);
    if (blocks) return blocks;
  }
  if (slug === "footer") return loadThemeDemoFooter(themeId, installedPath);
  return null;
}

export function loadThemeDemoHome(
  themeId: string,
  installedPath?: string | null,
): BlockNode[] | null {
  const dir = resolveThemeDir(themeId, installedPath);
  if (!dir) return null;

  const data = readJsonFile<{ blocks?: BlockNode[] }>(dir, "demo", "home.json");
  if (!data?.blocks || !Array.isArray(data.blocks)) return null;
  return data.blocks;
}

export function loadThemeDemoBlog(
  themeId: string,
  installedPath?: string | null,
): BlockNode[] | null {
  const dir = resolveThemeDir(themeId, installedPath);
  if (!dir) return null;

  const data = readJsonFile<{ blocks?: BlockNode[] }>(dir, "demo", "blog.json");
  if (!data?.blocks || !Array.isArray(data.blocks)) return null;
  return data.blocks;
}

/** The theme's default site footer blocks (`demo/footer.json`), used when the site never customised one. */
export function loadThemeDemoFooter(
  themeId: string,
  installedPath?: string | null,
): BlockNode[] | null {
  const dir = resolveThemeDir(themeId, installedPath);
  if (!dir) return null;

  const data = readJsonFile<{ blocks?: BlockNode[] }>(dir, "demo", "footer.json");
  if (!data?.blocks || !Array.isArray(data.blocks)) return null;
  return data.blocks;
}

/**
 * The theme's default site header chrome (`demo/header.json`) — a sparse
 * {@link PageHeaderConfig} the caller merges over `DEFAULT_PAGE_HEADER`. Used
 * when the site header library has no default entry.
 */
export function loadThemeDemoHeader(
  themeId: string,
  installedPath?: string | null,
): Record<string, unknown> | null {
  const dir = resolveThemeDir(themeId, installedPath);
  if (!dir) return null;

  const data = readJsonFile<Record<string, unknown>>(dir, "demo", "header.json");
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data;
}
