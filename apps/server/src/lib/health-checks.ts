// SPDX-License-Identifier: MIT

import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { getDb } from "./db.js";
import { getJfCache } from "./jf-cache.js";
import { inspectCacheStorage } from "./public-cache.js";

/**
 * Shared platform health checks behind the admin `/api/health` route and the
 * federated management API's `/health`. Output carries database connection
 * errors (which name the host and driver), memory figures, and which
 * environment variables are unset — administrator-only information.
 */

export interface CheckResult {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

export interface HealthReport {
  status: "ok" | "warn" | "error";
  checks: CheckResult[];
  uptime: number;
  timestamp: string;
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
    const hitRate =
      total > 0 ? `${Math.round((stats.hits / total) * 100)}% hit rate` : "no requests yet";
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

export async function runHealthChecks(): Promise<HealthReport> {
  const [dbCheck, fsCheck, cacheCheck] = await Promise.all([
    checkDatabase(),
    checkFilesystem(),
    checkCache(),
  ]);
  const checks = [dbCheck, fsCheck, cacheCheck, checkMemory(), checkNodeVersion(), checkEnv()];
  const status = checks.some((c) => c.status === "error")
    ? "error"
    : checks.some((c) => c.status === "warn")
      ? "warn"
      : "ok";
  return {
    status,
    checks,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}
