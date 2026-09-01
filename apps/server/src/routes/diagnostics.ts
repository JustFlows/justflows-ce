// SPDX-License-Identifier: MIT

import { gzipSync } from "node:zlib";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { debugMode, recentDiagnosticErrors, recentRequestTraces, redactDiagnosticValue } from "../lib/diagnostics.js";
import { getJfCache } from "../lib/jf-cache.js";
import { getRuntimeHooks } from "../lib/plugin-runtime.js";
import { getJustflowsVersion } from "../lib/version.js";
import { MIGRATION_ORDER } from "../lib/run-migrations.js";
import { requireRole } from "../middleware/auth.js";
import { sendServerError } from "../lib/send-error.js";
import { applyEnvToProcess, updateEnvKeys } from "../lib/env-file.js";
import { getJfRoot } from "../lib/jf-root.js";
import { packagesInstalledDir } from "../lib/packages-dir.js";
import { auditFromRequest } from "../lib/audit-log.js";

const router = Router();
const diagnosticsLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many diagnostics requests" },
});

router.use(requireRole("administrator"), diagnosticsLimit, (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

interface PluginDiagnosticRow {
  plugin_id: string;
  version: string;
  status: string;
  approved_permissions: string | string[];
  manifest: string | Record<string, unknown>;
}

interface ThemeDiagnosticRow {
  theme_id: string;
  version: string;
  status: string;
  manifest: string | Record<string, unknown>;
}

type ExtensionKind = "plugin" | "theme";
type ExtensionSource = "development" | "marketplace" | "database";
interface ExtensionInventoryItem {
  kind: ExtensionKind;
  id: string;
  name: string;
  version: string;
  source: ExtensionSource;
  status: string;
  registered: boolean;
  onDisk: boolean;
  permissions: string[];
  path: string | null;
}

function parseManifest(value: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof value !== "string") return value ?? {};
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
}

function readExtensionManifest(dir: string, kind: ExtensionKind): Record<string, unknown> | null {
  const names = kind === "theme"
    ? ["justflows-theme.json", "justflows.json"]
    : ["justflows.json", "justflows-plugin.json", "package.json"];
  for (const name of names) {
    try {
      const file = path.join(dir, name);
      if (!fs.statSync(file).isFile()) continue;
      return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      // Try the next supported manifest name.
    }
  }
  return null;
}

function extensionItem(
  kind: ExtensionKind,
  source: ExtensionSource,
  dir: string | null,
  manifest: Record<string, unknown>,
  fallbackId: string,
): ExtensionInventoryItem {
  const root = getJfRoot();
  const safeDir = dir ? path.resolve(dir) : null;
  const knownRoots = ["plugins", "themes", "packages-installed"].map((name) => path.join(root, name));
  const trustedDir = safeDir && knownRoots.some((knownRoot) => {
    const relative = path.relative(knownRoot, safeDir);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  }) ? safeDir : null;
  const id = String(manifest.id ?? manifest.name ?? fallbackId);
  const permissions = Array.isArray(manifest.permissions)
    ? manifest.permissions.filter((value): value is string => typeof value === "string")
    : [];
  return {
    kind,
    id,
    name: String(manifest.name ?? id),
    version: String(manifest.version ?? "unknown"),
    source,
    status: "not registered",
    registered: false,
    onDisk: trustedDir !== null && fs.existsSync(trustedDir),
    permissions,
    path: trustedDir ? path.relative(root, trustedDir) : null,
  };
}

function scanDevelopment(kind: ExtensionKind): ExtensionInventoryItem[] {
  const root = path.join(getJfRoot(), kind === "plugin" ? "plugins" : "themes");
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .flatMap((entry) => {
        const dir = path.join(root, entry.name);
        const manifest = readExtensionManifest(dir, kind);
        return manifest ? [extensionItem(kind, "development", dir, manifest, entry.name)] : [];
      });
  } catch { return []; }
}

function scanMarketplace(kind: ExtensionKind): ExtensionInventoryItem[] {
  const root = path.join(packagesInstalledDir(), kind === "plugin" ? "plugins" : "themes");
  const items: ExtensionInventoryItem[] = [];
  let ids: fs.Dirent[];
  try { ids = fs.readdirSync(root, { withFileTypes: true }); } catch { return items; }
  for (const idEntry of ids) {
    if (!idEntry.isDirectory() || idEntry.name.startsWith(".")) continue;
    const idDir = path.join(root, idEntry.name);
    const direct = readExtensionManifest(idDir, kind);
    if (direct) {
      items.push(extensionItem(kind, "marketplace", idDir, direct, idEntry.name));
      continue;
    }
    let versions: fs.Dirent[];
    try { versions = fs.readdirSync(idDir, { withFileTypes: true }); } catch { continue; }
    for (const versionEntry of versions) {
      if (!versionEntry.isDirectory() || versionEntry.name.startsWith(".")) continue;
      const dir = path.join(idDir, versionEntry.name);
      const manifest = readExtensionManifest(dir, kind);
      if (manifest) items.push(extensionItem(kind, "marketplace", dir, manifest, idEntry.name));
    }
  }
  return items;
}

async function databaseDiagnostics() {
  const started = performance.now();
  const db = await getDb();
  await db.query("SELECT 1");
  const migrations = await db.query<{ name: string }>("SELECT name FROM _migrations");
  const applied = new Set(migrations.map((row) => row.name));
  return {
    driver: process.env.DB_DRIVER ?? "unknown",
    connected: true,
    latencyMs: Math.round((performance.now() - started) * 100) / 100,
    migrations: {
      applied: migrations.length,
      current: MIGRATION_ORDER.every((name) => applied.has(name)),
      pending: MIGRATION_ORDER.filter((name) => !applied.has(name)),
    },
  };
}

async function extensionDiagnostics(siteId: string) {
  const db = await getDb();
  const [pluginRows, themeRows] = await Promise.all([
    db.query<PluginDiagnosticRow>("SELECT plugin_id, version, status, approved_permissions, manifest FROM plugins WHERE site_id = ? ORDER BY plugin_id", [siteId]),
    db.query<ThemeDiagnosticRow>("SELECT theme_id, version, status, manifest FROM themes WHERE site_id = ? ORDER BY theme_id", [siteId]),
  ]);
  const dbPlugins = new Map(pluginRows.map((row) => [row.plugin_id, row]));
  const dbThemes = new Map(themeRows.map((row) => [row.theme_id, row]));
  const mergeDb = (item: ExtensionInventoryItem): ExtensionInventoryItem => {
    const row = item.kind === "plugin" ? dbPlugins.get(item.id) : dbThemes.get(item.id);
    if (!row) return item;
    return {
      ...item,
      version: row.version || item.version,
      status: row.status,
      registered: true,
      permissions: "approved_permissions" in row
        ? parsePermissions(row.approved_permissions)
        : item.permissions,
    };
  };
  const plugins = [...scanDevelopment("plugin"), ...scanMarketplace("plugin")].map(mergeDb);
  const themes = [...scanDevelopment("theme"), ...scanMarketplace("theme")].map(mergeDb);
  const addDatabaseOnly = (kind: ExtensionKind, rows: Map<string, PluginDiagnosticRow | ThemeDiagnosticRow>, items: ExtensionInventoryItem[]) => {
    for (const [id, row] of rows) {
      if (items.some((item) => item.id === id)) continue;
      const manifest = parseManifest(row.manifest);
      const installedPath = typeof manifest.installedPath === "string" ? manifest.installedPath : null;
      items.push(mergeDb(extensionItem(kind, "database", installedPath, { ...manifest, version: row.version }, id)));
    }
  };
  addDatabaseOnly("plugin", dbPlugins, plugins);
  addDatabaseOnly("theme", dbThemes, themes);
  return { plugins, themes };
}

function parsePermissions(value: string | string[]): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch { return []; }
}

async function buildReport(siteId: string) {
  const cache = getJfCache();
  const cacheStats = cache.getStats();
  const total = cacheStats.hits + cacheStats.misses;
  const memory = process.memoryUsage();
  const systemTotalBytes = os.totalmem();
  const systemFreeBytes = os.freemem();
  const [database, extensions] = await Promise.all([databaseDiagnostics(), extensionDiagnostics(siteId)]);
  const hooks = getRuntimeHooks().inspect();
  const debug = debugMode();
  return {
    generatedAt: new Date().toISOString(),
    runtime: {
      justflowsVersion: getJustflowsVersion(),
      nodeVersion: process.version,
      mode: process.env.NODE_ENV ?? "development",
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        systemUsedBytes: systemTotalBytes - systemFreeBytes,
        systemTotalBytes,
      },
      debug,
      warnings: debug.enabled && debug.production
        ? ["Debug mode is enabled in production. Set JF_DEBUG=false or configure JF_DEBUG_EXPIRES_AT."]
        : [],
    },
    database,
    cache: {
      enabled: cache.enabled,
      stats: { ...cacheStats, hitRate: total === 0 ? null : Math.round((cacheStats.hits / total) * 10_000) / 100 },
    },
    extensions,
    hooks: {
      handlers: hooks,
      totals: {
        handlers: hooks.length,
        runs: hooks.reduce((sum, hook) => sum + hook.runs, 0),
        errors: hooks.reduce((sum, hook) => sum + hook.errors, 0),
        disabled: hooks.filter((hook) => hook.disabled).length,
      },
    },
    errors: recentDiagnosticErrors(),
    traces: recentRequestTraces(),
  };
}

router.get("/", async (req, res) => {
  try {
    res.json(await buildReport(req.session!.siteId));
  } catch (err) {
    sendServerError(res, "diagnostics", err);
  }
});

const DebugSettingsSchema = z.object({
  enabled: z.boolean(),
  expiresInHours: z.number().int().min(1).max(168).optional(),
});

router.post("/debug", async (req, res) => {
  const parsed = DebugSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid debug settings" });
    return;
  }
  const updates = parsed.data.enabled
    ? {
        JF_DEBUG: "true",
        JF_DEBUG_EXPIRES_AT: new Date(
          Date.now() + (parsed.data.expiresInHours ?? 4) * 60 * 60 * 1_000,
        ).toISOString(),
      }
    : { JF_DEBUG: "false", JF_DEBUG_EXPIRES_AT: null };
  try {
    await updateEnvKeys(updates);
    applyEnvToProcess(updates);
    auditFromRequest(req, parsed.data.enabled ? "diagnostics.debug_enabled" : "diagnostics.debug_disabled", {
      detail: parsed.data.enabled ? `expires_in_hours=${parsed.data.expiresInHours ?? 4}` : null,
    });
    res.json({ ok: true, debug: debugMode() });
  } catch (err) {
    sendServerError(res, "diagnostics debug settings", err);
  }
});

router.get("/bundle/preview", async (req, res) => {
  try {
    const report = redactDiagnosticValue(await buildReport(req.session!.siteId));
    res.json({
      format: "application/gzip containing diagnostics.json",
      expires: "Generated on demand; not retained on the server",
      includes: ["runtime", "database", "cache", "development and Marketplace plugin/theme inventory", "hooks", "recent request traces", "recent sanitized errors"],
      excludes: ["environment values", "credentials", "cookies", "request bodies", "database contents", "uploads"],
      preview: report,
    });
  } catch (err) {
    sendServerError(res, "diagnostics bundle preview", err);
  }
});

router.post("/bundle", async (req, res) => {
  if (req.body?.confirmed !== true) {
    res.status(400).json({ error: "Explicit confirmation is required" });
    return;
  }
  try {
    const report = redactDiagnosticValue(await buildReport(req.session!.siteId));
    const contents = Buffer.from(JSON.stringify(report, null, 2));
    if (contents.length > 5 * 1024 * 1024) {
      res.status(413).json({ error: "Diagnostics bundle exceeds the 5 MB limit" });
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="justflows-diagnostics-${stamp}.json.gz"`);
    auditFromRequest(req, "diagnostics.bundle_generated", { detail: `bytes=${contents.length}` });
    res.send(gzipSync(contents));
  } catch (err) {
    sendServerError(res, "diagnostics bundle", err);
  }
});

export default router;
