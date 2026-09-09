// SPDX-License-Identifier: MIT

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { clientIp } from "../../lib/rate-limit.js";
import { listPlugins } from "../../lib/plugins-db.js";
import { activatePluginAdmin, deactivatePluginAdmin } from "../../lib/plugins-admin.js";
import { listThemes } from "../../lib/themes-db.js";
import { getSiteId } from "../../lib/site-settings.js";
import { activateThemeAdmin } from "../../lib/themes-admin.js";
import { getJfCache, wipeCacheStorage } from "../../lib/jf-cache.js";
import { inspectCacheStorage } from "../../lib/public-cache.js";
import { clearStaticExport, getStaticExportStatus, runStaticExport } from "../../lib/static-export/index.js";
import { getJustflowsVersion } from "../../lib/version.js";
import { MIGRATION_ORDER } from "../../lib/run-migrations.js";
import { recentDiagnosticErrors, debugMode } from "../../lib/diagnostics.js";
import { runHealthChecks } from "../../lib/health-checks.js";
import { sendServerError } from "../../lib/send-error.js";
import { ensureKeyCan, relay, sendJson } from "./envelope.js";
import type { Request } from "express";

const router = Router();

function pluginActor(req: Request) {
  return {
    siteId: req.apiKeyOwner!.siteId,
    userId: req.apiKeyOwner!.userId,
    role: "api-key",
    ip: clientIp(req),
    userAgent: req.get("user-agent") ?? null,
  };
}

// The filesystem-touching routes carry their own express-rate-limit so CodeQL's
// js/missing-rate-limiting is satisfied independent of the per-key limiter.
const expensiveLimit = rateLimit({
  windowMs: 60_000,
  limit: 6,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `manage-system:${req.apiKey?.id ?? clientIp(req)}`,
});

/* ------------------------------ plugins ------------------------------- */

router.get("/plugins", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "plugins:read"))) return;
  try {
    sendJson(req, res, { plugins: await listPlugins(req.apiKeyOwner!.siteId) });
  } catch (err) {
    sendServerError(res, "manage.plugins", err);
  }
});

router.post("/plugins/:id/activate", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "plugins:activate"))) return;
  try {
    relay(res, await activatePluginAdmin(req.params.id, pluginActor(req)));
  } catch (err) {
    sendServerError(res, "manage.plugins", err);
  }
});

router.post("/plugins/:id/deactivate", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "plugins:activate"))) return;
  try {
    relay(res, await deactivatePluginAdmin(req.params.id, pluginActor(req)));
  } catch (err) {
    sendServerError(res, "manage.plugins", err);
  }
});

/* ------------------------------- themes ------------------------------- */

router.get("/themes", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "themes:read"))) return;
  try {
    const siteId = await getSiteId();
    sendJson(req, res, { themes: siteId ? await listThemes(siteId) : [] });
  } catch (err) {
    sendServerError(res, "manage.themes", err);
  }
});

router.post("/themes/:id/activate", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "themes:activate"))) return;
  try {
    relay(
      res,
      await activateThemeAdmin(req.params.id, {
        userId: req.apiKeyOwner!.userId,
        role: "api-key",
        ip: clientIp(req),
        userAgent: req.get("user-agent") ?? null,
      }),
    );
  } catch (err) {
    sendServerError(res, "manage.themes", err);
  }
});

/* -------------------------------- cache ------------------------------- */

router.get("/cache/stats", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:read"))) return;
  try {
    const cache = getJfCache();
    const storage = await inspectCacheStorage();
    sendJson(req, res, { enabled: cache.enabled, stats: cache.getStats(), storage });
  } catch (err) {
    sendServerError(res, "manage.cache", err);
  }
});

router.post("/cache/clear", expensiveLimit, async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  try {
    const cache = getJfCache();
    await cache.clear();
    await wipeCacheStorage();
    res.json({ ok: true, enabled: cache.enabled, stats: cache.getStats() });
  } catch (err) {
    sendServerError(res, "manage.cache", err);
  }
});

/* --------------------------- static export --------------------------- */

router.get("/static-export", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:read"))) return;
  try {
    sendJson(req, res, await getStaticExportStatus());
  } catch (err) {
    sendServerError(res, "manage.static-export", err);
  }
});

router.post("/static-export/run", expensiveLimit, async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  const mode = (req.body as { mode?: unknown })?.mode === "incremental" ? "incremental" : "full";
  const log: string[] = [];
  try {
    const summary = await runStaticExport({ mode, reason: "admin", log: (line) => log.push(line) });
    res.json({ ok: summary.ok, summary, log });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err), log });
  }
});

router.post("/static-export/clear", expensiveLimit, async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  try {
    const force = (req.body as { force?: unknown })?.force === true;
    const result = await clearStaticExport({ force });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    sendServerError(res, "manage.static-export", err);
  }
});

/* --------------------------- diagnostics ----------------------------- */

router.get("/diagnostics", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "site:admin"))) return;
  try {
    sendJson(req, res, {
      version: getJustflowsVersion(),
      node: process.version,
      uptime: Math.floor(process.uptime()),
      debug: debugMode(),
      migrations: MIGRATION_ORDER,
      recentErrorCount: recentDiagnosticErrors().length,
    });
  } catch (err) {
    sendServerError(res, "manage.diagnostics", err);
  }
});

router.get("/health", async (_req, res) => {
  res.json(await runHealthChecks());
});

export default router;
