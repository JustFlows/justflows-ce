import path from "node:path";
import { z } from "zod";
import { parseEnvBool } from "@justflows/core";
import { getJfRoot } from "./jf-root.js";
import { applyEnvToProcess, readEnvMap, updateEnvKeys } from "./env-file.js";
import { resetJfCache } from "./jf-cache.js";
import { requestPassengerRestart } from "./app-restart.js";
import {
  CacheSettingsBodySchema,
  type CacheSettings,
  readCacheSettings,
} from "./cache-settings.js";
import {
  defaultRevalidateObjects,
  getRevalidateSettings,
  revalidateObjectsToEnv,
  type RevalidateSettings,
} from "./cache-revalidate.js";
import fs from "node:fs/promises";

export const GzipSettingsSchema = z.object({
  enabled: z.boolean(),
  level: z.coerce.number().int().min(1).max(9),
  minBytes: z.coerce.number().int().min(256).max(65536),
});

export const BrowserCacheSettingsSchema = z.object({
  enabled: z.boolean(),
  htmlMaxAge: z.coerce.number().int().min(0).max(86400),
  staticMaxAge: z.coerce.number().int().min(0).max(31536000),
  staleWhileRevalidate: z.coerce.number().int().min(0).max(86400),
});

export const RevalidateSettingsSchema = z.object({
  enabled: z.boolean(),
  objects: z.object({
    pages: z.boolean(),
    content: z.boolean(),
    menus: z.boolean(),
    theme: z.boolean(),
    cssProviders: z.boolean(),
    site: z.boolean(),
  }),
});

export const PerformanceSettingsBodySchema = z.object({
  cache: CacheSettingsBodySchema,
  gzip: GzipSettingsSchema,
  browserCache: BrowserCacheSettingsSchema,
  revalidate: RevalidateSettingsSchema,
});

export type GzipSettings = z.infer<typeof GzipSettingsSchema>;
export type BrowserCacheSettings = z.infer<typeof BrowserCacheSettingsSchema>;
export type PerformanceSettings = z.infer<typeof PerformanceSettingsBodySchema>;

export interface PerformanceRuntimeConfig {
  cache: CacheSettings & { redisUrl: string; defaultDir: string };
  gzip: GzipSettings;
  browserCache: BrowserCacheSettings;
  revalidate: RevalidateSettings;
}

function envGet(map: Map<string, string>, key: string): string | undefined {
  return map.get(key) ?? process.env[key];
}

function intEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Synchronous config for middleware (reads process.env). */
export function getPerformanceConfig(): PerformanceRuntimeConfig {
  return {
    cache: {
      enabled: parseEnvBool(process.env.CACHE_ENABLED, true),
      driver: process.env.CACHE_DRIVER === "memory" ? "memory" : "filesystem",
      ttlSeconds: intEnv(process.env.CACHE_TTL_SECONDS, 300),
      dir: process.env.CACHE_DIR ?? path.join(getJfRoot(), ".cache"),
      redisUrl: process.env.CACHE_REDIS_URL ?? "",
      defaultDir: path.join(getJfRoot(), ".cache"),
    },
    gzip: {
      enabled: parseEnvBool(process.env.JF_GZIP_ENABLED, true),
      level: intEnv(process.env.JF_GZIP_LEVEL, 6),
      minBytes: intEnv(process.env.JF_GZIP_MIN_BYTES, 1024),
    },
    browserCache: {
      enabled: parseEnvBool(process.env.JF_BROWSER_CACHE_ENABLED, true),
      htmlMaxAge: intEnv(process.env.JF_BROWSER_CACHE_HTML_MAX_AGE, 60),
      staticMaxAge: intEnv(process.env.JF_BROWSER_CACHE_STATIC_MAX_AGE, 86400),
      staleWhileRevalidate: intEnv(process.env.JF_BROWSER_CACHE_SWR, 300),
    },
    revalidate: getRevalidateSettings(),
  };
}

export async function readPerformanceSettings(): Promise<{
  settings: PerformanceRuntimeConfig;
  runtime: Awaited<ReturnType<typeof readCacheSettings>>["runtime"] & {
    gzip: boolean;
    browserCache: boolean;
    revalidate: boolean;
  };
  envPath: string;
}> {
  const map = await readEnvMap();
  const cacheSnapshot = await readCacheSettings();
  const revalidate = getRevalidateSettings();

  // Prefer .env map for revalidate when present (same process as other keys)
  if (map.has("CACHE_REVALIDATE_ENABLED") || map.has("CACHE_REVALIDATE_OBJECTS")) {
    process.env.CACHE_REVALIDATE_ENABLED =
      envGet(map, "CACHE_REVALIDATE_ENABLED") ?? process.env.CACHE_REVALIDATE_ENABLED;
    process.env.CACHE_REVALIDATE_OBJECTS =
      envGet(map, "CACHE_REVALIDATE_OBJECTS") ?? process.env.CACHE_REVALIDATE_OBJECTS;
  }

  const settings: PerformanceRuntimeConfig = {
    cache: cacheSnapshot.settings,
    gzip: {
      enabled: parseEnvBool(envGet(map, "JF_GZIP_ENABLED"), true),
      level: intEnv(envGet(map, "JF_GZIP_LEVEL"), 6),
      minBytes: intEnv(envGet(map, "JF_GZIP_MIN_BYTES"), 1024),
    },
    browserCache: {
      enabled: parseEnvBool(envGet(map, "JF_BROWSER_CACHE_ENABLED"), true),
      htmlMaxAge: intEnv(envGet(map, "JF_BROWSER_CACHE_HTML_MAX_AGE"), 60),
      staticMaxAge: intEnv(envGet(map, "JF_BROWSER_CACHE_STATIC_MAX_AGE"), 86400),
      staleWhileRevalidate: intEnv(envGet(map, "JF_BROWSER_CACHE_SWR"), 300),
    },
    revalidate: {
      enabled: parseEnvBool(envGet(map, "CACHE_REVALIDATE_ENABLED"), true),
      objects: (() => {
        const raw = envGet(map, "CACHE_REVALIDATE_OBJECTS");
        if (!raw) return defaultRevalidateObjects();
        const selected = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
        const objects = defaultRevalidateObjects();
        for (const key of Object.keys(objects) as (keyof typeof objects)[]) {
          objects[key] = selected.has(key);
        }
        return objects;
      })(),
    },
  };

  return {
    settings,
    runtime: {
      ...cacheSnapshot.runtime,
      gzip: getPerformanceConfig().gzip.enabled,
      browserCache: getPerformanceConfig().browserCache.enabled,
      revalidate: revalidate.enabled,
    },
    envPath: path.join(getJfRoot(), ".env"),
  };
}

function performanceToEnvUpdates(body: PerformanceSettings): Record<string, string | null> {
  const cacheUpdates = {
    CACHE_ENABLED: body.cache.enabled ? "1" : "0",
    CACHE_DRIVER: body.cache.driver,
    CACHE_TTL_SECONDS: String(body.cache.ttlSeconds),
    CACHE_DIR:
      body.cache.driver === "filesystem"
        ? body.cache.dir?.trim() || path.join(getJfRoot(), ".cache")
        : null,
    CACHE_REDIS_URL: body.cache.redisUrl?.trim() ? body.cache.redisUrl.trim() : null,
  };

  return {
    ...cacheUpdates,
    JF_GZIP_ENABLED: body.gzip.enabled ? "1" : "0",
    JF_GZIP_LEVEL: String(body.gzip.level),
    JF_GZIP_MIN_BYTES: String(body.gzip.minBytes),
    JF_BROWSER_CACHE_ENABLED: body.browserCache.enabled ? "1" : "0",
    JF_BROWSER_CACHE_HTML_MAX_AGE: String(body.browserCache.htmlMaxAge),
    JF_BROWSER_CACHE_STATIC_MAX_AGE: String(body.browserCache.staticMaxAge),
    JF_BROWSER_CACHE_SWR: String(body.browserCache.staleWhileRevalidate),
    CACHE_REVALIDATE_ENABLED: body.revalidate.enabled ? "1" : "0",
    CACHE_REVALIDATE_OBJECTS: revalidateObjectsToEnv(body.revalidate.objects),
  };
}

export async function applyPerformanceSettings(body: PerformanceSettings): Promise<{
  ok: boolean;
  restarting: boolean;
  restartRequired: boolean;
  settings: PerformanceRuntimeConfig;
}> {
  const parsed = PerformanceSettingsBodySchema.parse(body);
  const updates = performanceToEnvUpdates(parsed);

  await updateEnvKeys(updates);
  applyEnvToProcess(updates);

  if (parsed.cache.driver === "filesystem") {
    const dir = parsed.cache.dir?.trim() || path.join(getJfRoot(), ".cache");
    await fs.mkdir(dir, { recursive: true });
  }

  resetJfCache();

  const restart = await requestPassengerRestart(getJfRoot());
  const snapshot = await readPerformanceSettings();

  return {
    ok: true,
    restarting: restart.ok,
    restartRequired: !restart.ok,
    settings: snapshot.settings,
  };
}
