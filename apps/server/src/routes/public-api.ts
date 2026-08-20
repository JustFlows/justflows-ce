import { Router } from "express";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { getDb } from "../lib/db.js";
import { getJfCache } from "../lib/jf-cache.js";
import { inspectCacheStorage } from "../lib/public-cache.js";
import { serializeContentRow } from "../lib/content-api.js";
import { resolveContentLocale } from "../lib/i18n/languages-db.js";
import { requireSession } from "../middleware/auth.js";
import {
  canViewUnpublishedSite,
  isSitePublic,
} from "../lib/site-visibility.js";

const router = Router();

async function ensurePublicApiAccess(
  req: Parameters<typeof canViewUnpublishedSite>[0],
  res: Parameters<typeof canViewUnpublishedSite>[1],
): Promise<boolean> {
  if (await isSitePublic()) return true;
  if (await canViewUnpublishedSite(req, res)) return true;
  res.status(404).json({ error: "Not found" });
  return false;
}

router.get("/", async (req, res) => {
  if (!(await ensurePublicApiAccess(req, res))) return;
  const type = req.query.type as string | undefined;
  const slug = req.query.slug as string | undefined;
  const localeParam = req.query.locale as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? "20"), 100);
  const cursor = req.query.cursor as string | undefined;

  try {
    const db = await getDb();
    const sites = await db.query<{ id: string }>("SELECT id FROM sites LIMIT 1");
    const siteId = sites[0]?.id;
    if (!siteId) {
      res.json({ items: [], total: 0 });
      return;
    }

    const locale = await resolveContentLocale(localeParam, siteId);

    let sql =
      "SELECT id, type, title, slug, locale, excerpt, status, published_at, updated_at FROM content WHERE site_id = ? AND status = 'published' AND locale = ?";
    const params: (string | number | boolean | null)[] = [siteId, locale];

    if (type) {
      sql += " AND type = ?";
      params.push(type);
    }
    if (slug) {
      sql += " AND slug = ?";
      params.push(slug);
    }
    if (cursor) {
      sql += " AND id > ?";
      params.push(cursor);
    }

    sql += " ORDER BY published_at DESC LIMIT ?";
    params.push(limit + 1);

    const rows = await db.query<Record<string, unknown>>(sql, params);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    res.json({
      items: items.map(serializeContentRow),
      nextCursor: hasMore ? items[items.length - 1]?.id : null,
      total: items.length,
      locale,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/:slug", async (req, res) => {
  if (!(await ensurePublicApiAccess(req, res))) return;

  try {
    const db = await getDb();
    const sites = await db.query<{ id: string }>("SELECT id FROM sites LIMIT 1");
    const siteId = sites[0]?.id;
    if (!siteId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const locale = await resolveContentLocale(req.query.locale as string | undefined, siteId);

    const rows = await db.query<Record<string, unknown>>(
      "SELECT * FROM content WHERE site_id = ? AND slug = ? AND locale = ? AND status = 'published' LIMIT 1",
      [siteId, req.params.slug, locale],
    );
    if (!rows[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json(serializeContentRow(rows[0]));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

const healthRouter = Router();

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

async function checkDatabase(): Promise<CheckResult> {
  try {
    const db = await getDb();
    await db.query("SELECT 1");
    return { name: "Database", status: "ok", message: "Connected" };
  } catch (e) {
    return { name: "Database", status: "error", message: String(e) };
  }
}

async function checkFilesystem(): Promise<CheckResult> {
  try {
    const uploadsDir = process.env.STORAGE_LOCAL_PATH ?? "./uploads";
    await fs.mkdir(uploadsDir, { recursive: true });
    const testFile = path.join(uploadsDir, ".healthcheck");
    await fs.writeFile(testFile, "ok");
    await fs.unlink(testFile);
    return { name: "Filesystem", status: "ok", message: "Writable" };
  } catch (e) {
    return { name: "Filesystem", status: "error", message: String(e) };
  }
}

function checkMemory(): CheckResult {
  const total = os.totalmem();
  const free = os.freemem();
  const usedPct = Math.round(((total - free) / total) * 100);
  return {
    name: "Memory",
    status: usedPct > 90 ? "warn" : "ok",
    message: `${usedPct}% used (${Math.round(free / 1024 / 1024)} MB free of ${Math.round(total / 1024 / 1024)} MB)`,
  };
}

function checkNodeVersion(): CheckResult {
  const version = process.version;
  const major = parseInt(version.slice(1), 10);
  return {
    name: "Node.js",
    status: major >= 22 ? "ok" : "warn",
    message: `${version} (requires ≥ 22)`,
  };
}

function checkEnv(): CheckResult {
  const missing = ["APP_SECRET", "DB_DRIVER"].filter((k) => !process.env[k]);
  return {
    name: "Environment",
    status: missing.length > 0 ? "error" : "ok",
    message: missing.length > 0 ? `Missing: ${missing.join(", ")}` : "All required vars set",
  };
}

async function checkCache(): Promise<CheckResult> {
  try {
    const cache = getJfCache();
    const stats = cache.getStats();
    const storage = await inspectCacheStorage();
    const total = stats.hits + stats.misses;
    const hitRate = total > 0 ? `${Math.round((stats.hits / total) * 100)}% hit rate` : "no requests yet";
    return {
      name: "Object cache",
      status: cache.enabled ? "ok" : "warn",
      message: cache.enabled
        ? `${storage.keyCount} keys, ${hitRate} (process lifetime)`
        : "Disabled via CACHE_ENABLED",
    };
  } catch (e) {
    return { name: "Object cache", status: "error", message: String(e) };
  }
}

healthRouter.get("/", requireSession, async (_req, res) => {
  const [dbCheck, fsCheck, cacheCheck] = await Promise.all([
    checkDatabase(),
    checkFilesystem(),
    checkCache(),
  ]);
  const checks = [dbCheck, fsCheck, cacheCheck, checkMemory(), checkNodeVersion(), checkEnv()];
  const overall = checks.some((c) => c.status === "error")
    ? "error"
    : checks.some((c) => c.status === "warn")
      ? "warn"
      : "ok";

  res.json({
    status: overall,
    checks,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

export { healthRouter };
export default router;
