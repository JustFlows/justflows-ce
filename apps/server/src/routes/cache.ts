import { Router } from "express";
import { getJfCache } from "../lib/jf-cache.js";
import {
  CacheSettingsBodySchema,
  readCacheSettings,
} from "../lib/cache-settings.js";
import {
  applyPerformanceSettings,
  getPerformanceConfig,
  PerformanceSettingsBodySchema,
} from "../lib/performance-settings.js";
import { inspectCacheStorage } from "../lib/public-cache.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();

router.get("/settings", requireRole("administrator"), async (_req, res) => {
  try {
    const cache = await readCacheSettings();
    const perf = getPerformanceConfig();
    res.json({
      ...cache,
      settings: {
        cache: cache.settings,
        gzip: perf.gzip,
        browserCache: perf.browserCache,
        revalidate: perf.revalidate,
      },
      runtime: {
        ...cache.runtime,
        gzip: perf.gzip.enabled,
        browserCache: perf.browserCache.enabled,
        revalidate: perf.revalidate.enabled,
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/stats", requireRole("administrator"), async (_req, res) => {
  try {
    const cache = getJfCache();
    const settings = await readCacheSettings();
    const perf = getPerformanceConfig();
    const storage = await inspectCacheStorage();
    const stats = cache.getStats();
    const total = stats.hits + stats.misses;
    const hitRate = total > 0 ? Math.round((stats.hits / total) * 100) : null;

    res.json({
      enabled: cache.enabled,
      gzip: perf.gzip,
      browserCache: perf.browserCache,
      revalidate: perf.revalidate,
      settings: settings.settings,
      runtime: settings.runtime,
      stats: { ...stats, hitRate },
      storage,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/settings", requireRole("administrator"), async (req, res) => {
  const perfBody = PerformanceSettingsBodySchema.safeParse(req.body);
  if (perfBody.success) {
    try {
      const result = await applyPerformanceSettings(perfBody.data);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
    return;
  }

  const body = CacheSettingsBodySchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid settings" });
    return;
  }

  try {
    const perf = getPerformanceConfig();
    const result = await applyPerformanceSettings({
      cache: body.data,
      gzip: perf.gzip,
      browserCache: perf.browserCache,
      revalidate: perf.revalidate,
    });
    res.json({
      ok: result.ok,
      restarting: result.restarting,
      restartRequired: result.restartRequired,
      settings: result.settings.cache,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/clear", requireRole("administrator"), async (_req, res) => {
  const cache = getJfCache();
  await cache.clear();
  res.json({
    ok: true,
    enabled: cache.enabled,
    clearedAt: new Date().toISOString(),
    stats: cache.getStats(),
  });
});

router.post("/stats/reset", requireRole("administrator"), async (_req, res) => {
  getJfCache().resetStats();
  res.json({ ok: true, stats: getJfCache().getStats() });
});

export default router;
