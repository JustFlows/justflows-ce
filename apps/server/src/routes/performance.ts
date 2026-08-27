import { Router } from "express";
import { getJfCache, wipeCacheStorage } from "../lib/jf-cache.js";
import {
  applyPerformanceSettings,
  getPerformanceConfig,
  PerformanceSettingsBodySchema,
  readPerformanceSettings,
} from "../lib/performance-settings.js";
import { inspectCacheStorage } from "../lib/public-cache.js";
import { requireRole } from "../middleware/auth.js";
import { sendServerError } from "../lib/send-error.js";

const router = Router();

router.get("/settings", requireRole("administrator"), async (_req, res) => {
  try {
    res.json(await readPerformanceSettings());
  } catch (err) {
    sendServerError(res, "performance", err);
  }
});

router.post("/settings", requireRole("administrator"), async (req, res) => {
  const body = PerformanceSettingsBodySchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid settings" });
    return;
  }

  try {
    const result = await applyPerformanceSettings(body.data);
    res.json(result);
  } catch (err) {
    sendServerError(res, "performance", err);
  }
});

router.get("/stats", requireRole("administrator"), async (_req, res) => {
  try {
    const cache = getJfCache();
    const perf = getPerformanceConfig();
    if (!cache.enabled) await wipeCacheStorage();
    const storage = await inspectCacheStorage();
    const stats = cache.getStats();
    const total = stats.hits + stats.misses;

    res.json({
      enabled: cache.enabled,
      gzip: perf.gzip,
      browserCache: perf.browserCache,
      revalidate: perf.revalidate,
      stats: { ...stats, hitRate: total > 0 ? Math.round((stats.hits / total) * 100) : null },
      storage,
    });
  } catch (err) {
    sendServerError(res, "performance", err);
  }
});

router.post("/clear", requireRole("administrator"), async (_req, res) => {
  const cache = getJfCache();
  await cache.clear();
  await wipeCacheStorage();
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
