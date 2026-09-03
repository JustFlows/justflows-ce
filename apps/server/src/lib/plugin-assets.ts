// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseEnvBool } from "@justflows/core";
import { getDb } from "./db.js";
import { getSiteId } from "./themes-db.js";
import { pluginsDir } from "./plugins-db.js";
import { resolvePathUnderBase } from "./safe-path.js";

/**
 * Client-side assets a plugin ships in its own package (`manifest.assets`). The
 * host serves `<dir>/**` at `/ext/<pluginId>/**` for direct access, and — by
 * default — **concatenates every active plugin's declared `scripts` / `styles`
 * into one content-hashed bundle** (`/jf-plugins.<hash>.js` / `.css`) so a page
 * loads at most one plugin script and one plugin stylesheet, whatever the
 * plugin count. The static exporter downloads the bundle like any other asset.
 * Set `PLUGIN_ASSETS_BUNDLE=0` to emit a `<script>` per plugin file instead.
 */

interface AssetBundle {
  hash: string;
  code: string;
  contentType: string;
}

interface PluginAssetSet {
  pluginId: string;
  /** Absolute path of the plugin's asset directory. */
  baseDir: string;
  /** Declared script paths, relative to `baseDir`, that exist on disk. */
  scripts: string[];
  /** Declared stylesheet paths, relative to `baseDir`, that exist on disk. */
  styles: string[];
}

const DIR_RE = /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/;
const REL_FILE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*\.(js|mjs|css)$/;
const PLUGIN_ID_RE = /^[a-z0-9]+(?:\.[a-z0-9-]+)+$/;

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

let cache: {
  at: number;
  sets: PluginAssetSet[];
  js: AssetBundle | null;
  css: AssetBundle | null;
} | null = null;
const TTL_MS = 15_000;

function bundlingEnabled(): boolean {
  return parseEnvBool(process.env.PLUGIN_ASSETS_BUNDLE, true);
}

/** Dev fallback: a bundled plugin under `plugins/` whose manifest id matches. */
export function bundledBasePathFor(pluginId: string): string | null {
  const dir = pluginsDir();
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const base = path.join(dir, name);
    for (const file of ["justflows.json", "justflows-plugin.json", "package.json"]) {
      const manifestFile = path.join(base, file);
      try {
        const raw = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as {
          id?: unknown;
          name?: unknown;
        };
        const id =
          typeof raw.id === "string" ? raw.id : typeof raw.name === "string" ? raw.name : "";
        if (id === pluginId) return base;
      } catch {
        // not this one
      }
    }
  }
  return null;
}

/** A safe relative asset path: `.js`/`.mjs`/`.css`, no `..`, not absolute. */
export function safeAssetRel(value: unknown): string | null {
  if (typeof value !== "string" || value.startsWith("/") || !REL_FILE_RE.test(value)) return null;
  if (value.split("/").includes("..")) return null;
  return value;
}

/** `<link>` / `<script>` tags for one plugin's asset lists (pure, no I/O). */
export function assetTags(
  pluginId: string,
  lists: { scripts?: readonly string[]; styles?: readonly string[] },
): string {
  if (!PLUGIN_ID_RE.test(pluginId)) return "";
  const tags: string[] = [];
  for (const href of lists.styles ?? []) {
    if (safeAssetRel(href)) {
      tags.push(`<link rel="stylesheet" href="/ext/${esc(pluginId)}/${esc(href)}">`);
    }
  }
  for (const src of lists.scripts ?? []) {
    if (safeAssetRel(src)) {
      tags.push(`<script src="/ext/${esc(pluginId)}/${esc(src)}" defer></script>`);
    }
  }
  return tags.join("\n");
}

async function loadPluginAssetSets(): Promise<PluginAssetSet[]> {
  const siteId = await getSiteId();
  if (!siteId) return [];

  const db = await getDb();
  const rows = await db.query<{ plugin_id: string; manifest: string | Record<string, unknown> }>(
    // Ordered so the concatenated bundle (and its content hash / URL) is stable
    // across restarts and replicas rather than following the driver's row order.
    "SELECT plugin_id, manifest FROM plugins WHERE site_id = ? AND status = 'active' ORDER BY plugin_id",
    [siteId],
  );

  const out: PluginAssetSet[] = [];
  for (const row of rows) {
    const pluginId = String(row.plugin_id);
    if (!PLUGIN_ID_RE.test(pluginId)) continue;

    let manifest: Record<string, unknown>;
    try {
      manifest =
        typeof row.manifest === "string"
          ? (JSON.parse(row.manifest) as Record<string, unknown>)
          : ((row.manifest ?? {}) as Record<string, unknown>);
    } catch {
      continue;
    }

    const basePath =
      (typeof manifest.installedPath === "string" && manifest.installedPath) ||
      (typeof manifest.bundledPath === "string" && manifest.bundledPath) ||
      bundledBasePathFor(pluginId) ||
      "";
    if (!basePath) continue;

    // Prefer the stored row; fall back to the on-disk manifest (matches how the
    // host refreshes `settingsSchema` / `setupPath` for plugins packaged before
    // a pipeline that strips unknown keys).
    let assets = manifest.assets;
    if (!assets || typeof assets !== "object") {
      const diskManifest = resolvePathUnderBase(basePath, "justflows.json");
      if (diskManifest && fs.existsSync(diskManifest)) {
        try {
          assets = (JSON.parse(fs.readFileSync(diskManifest, "utf8")) as Record<string, unknown>)
            .assets;
        } catch {
          assets = undefined;
        }
      }
    }
    if (!assets || typeof assets !== "object") continue;
    const spec = assets as { dir?: unknown; scripts?: unknown; styles?: unknown };

    const dirName = typeof spec.dir === "string" && spec.dir ? spec.dir : "public";
    if (!DIR_RE.test(dirName) || dirName.split("/").includes("..")) continue;

    const baseDir = resolvePathUnderBase(basePath, dirName);
    if (!baseDir || !fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) continue;

    const pick = (list: unknown): string[] => {
      if (!Array.isArray(list)) return [];
      const seen: string[] = [];
      for (const raw of list.slice(0, 20)) {
        const rel = safeAssetRel(raw);
        if (!rel) continue;
        const abs = resolvePathUnderBase(baseDir, rel);
        if (abs && fs.existsSync(abs) && fs.statSync(abs).isFile() && !seen.includes(rel)) {
          seen.push(rel);
        }
      }
      return seen;
    };

    // `baseDir` is a valid directory here — serve its files at /ext/<id>/**
    // even if nothing is auto-enqueued.
    out.push({ pluginId, baseDir, scripts: pick(spec.scripts), styles: pick(spec.styles) });
  }
  return out;
}

/** Concatenate `kind` files across every set into one hashed bundle, or null. */
export function buildBundle(
  sets: Array<{ pluginId: string; baseDir: string; scripts: string[]; styles: string[] }>,
  kind: "js" | "css",
): AssetBundle | null {
  const parts: string[] = [];
  for (const set of sets) {
    const rels = kind === "js" ? set.scripts : set.styles;
    for (const rel of rels) {
      const abs = resolvePathUnderBase(set.baseDir, rel);
      if (!abs) continue;
      let src: string;
      try {
        src = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const banner = `/* ${set.pluginId}/${rel} */\n`;
      // Wrap each script so a stray top-level `var` / missing `;` in one plugin
      // cannot break the next. Stylesheets just concatenate.
      parts.push(kind === "js" ? `${banner};(function(){\n${src}\n})();\n` : `${banner}${src}\n`);
    }
  }
  if (parts.length === 0) return null;
  const code = parts.join("\n");
  return {
    hash: createHash("sha256").update(code).digest("hex").slice(0, 16),
    code,
    contentType: kind === "js" ? CONTENT_TYPES[".js"]! : CONTENT_TYPES[".css"]!,
  };
}

async function getState(): Promise<{
  sets: PluginAssetSet[];
  js: AssetBundle | null;
  css: AssetBundle | null;
}> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache;
  const sets = await loadPluginAssetSets().catch(() => [] as PluginAssetSet[]);
  cache = {
    at: now,
    sets,
    js: buildBundle(sets, "js"),
    css: buildBundle(sets, "css"),
  };
  return cache;
}

async function getPluginAssetSets(): Promise<PluginAssetSet[]> {
  return (await getState()).sets;
}

/** Drop the memo — call after a plugin activates / deactivates. */
export function clearPluginAssetsCache(): void {
  cache = null;
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * The `<link>` / `<script>` for every active plugin's declared assets — one
 * bundled `/jf-plugins.<hash>.{css,js}` pair by default, or a tag per file when
 * `PLUGIN_ASSETS_BUNDLE=0`.
 */
export async function renderPluginAssetHeadHtml(): Promise<string> {
  const state = await getState();
  if (!bundlingEnabled()) {
    return state.sets
      .map((set) => assetTags(set.pluginId, set))
      .filter(Boolean)
      .join("\n");
  }
  const tags: string[] = [];
  if (state.css) tags.push(`<link rel="stylesheet" href="/jf-plugins.${state.css.hash}.css">`);
  if (state.js) tags.push(`<script src="/jf-plugins.${state.js.hash}.js" defer></script>`);
  return tags.join("\n");
}

/**
 * Serve `/jf-plugins.<hash>.<ext>`. Returns the current bundle even if `hash` is
 * stale (a page cached before a plugin change), flagging `immutable` only on an
 * exact match so a stale URL is revalidated.
 */
export async function getPluginBundle(
  ext: "js" | "css",
  hash: string,
): Promise<{ code: string; contentType: string; immutable: boolean } | null> {
  const bundle = (await getState())[ext];
  if (!bundle) return null;
  return {
    code: bundle.code,
    contentType: bundle.contentType,
    immutable: bundle.hash === hash,
  };
}

/** Resolve a request for `/ext/<pluginId>/<relPath>` to a file to serve, or null. */
export async function resolvePluginAssetFile(
  pluginId: string,
  relPath: string,
): Promise<{ absPath: string; contentType: string } | null> {
  if (!PLUGIN_ID_RE.test(pluginId)) return null;
  const rel = safeAssetRel(relPath);
  if (!rel) return null;

  const sets = await getPluginAssetSets();
  const set = sets.find((s) => s.pluginId === pluginId);
  if (!set) return null;

  const abs = resolvePathUnderBase(set.baseDir, rel);
  if (!abs) return null;
  try {
    if (fs.lstatSync(abs).isSymbolicLink() || !fs.statSync(abs).isFile()) return null;
  } catch {
    return null;
  }
  const ext = rel.slice(rel.lastIndexOf(".")).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) return null;
  return { absPath: abs, contentType };
}
