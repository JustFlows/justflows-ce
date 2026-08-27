import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { parseEnvBool } from "@justflows/core";
import { getJfRoot } from "./jf-root.js";
import { applyEnvToProcess, readEnvMap, updateEnvKeys } from "./env-file.js";
import { resetJfCache, wipeCacheStorage } from "./jf-cache.js";
import { requestPassengerRestart } from "./app-restart.js";

export const CacheSettingsBodySchema = z.object({
  enabled: z.boolean(),
  driver: z.enum(["memory", "filesystem"]),
  ttlSeconds: z.coerce.number().int().min(0).max(86400),
  dir: z.string().min(1).optional(),
  redisUrl: z.string().optional(),
});

export type CacheSettings = z.infer<typeof CacheSettingsBodySchema>;

export interface CacheSettingsResponse {
  settings: CacheSettings & { redisUrl: string; defaultDir: string };
  runtime: {
    active: boolean;
    driver: string;
    ttlSeconds: number;
  };
  envPath: string;
}

function defaultCacheDir(): string {
  return path.join(getJfRoot(), ".cache");
}

function envGet(map: Map<string, string>, key: string): string | undefined {
  return map.get(key) ?? process.env[key];
}

/** Read cache configuration from .env (with sensible defaults). */
export async function readCacheSettings(): Promise<CacheSettingsResponse> {
  const map = await readEnvMap();
  const driverRaw = envGet(map, "CACHE_DRIVER") ?? "filesystem";
  const driver = driverRaw === "memory" ? "memory" : "filesystem";
  const ttlRaw = envGet(map, "CACHE_TTL_SECONDS");
  const ttlSeconds = ttlRaw !== undefined ? Math.max(0, parseInt(ttlRaw, 10) || 0) : 300;
  const dir = envGet(map, "CACHE_DIR") ?? defaultCacheDir();
  const redisUrl = envGet(map, "CACHE_REDIS_URL") ?? "";

  const settings: CacheSettingsResponse["settings"] = {
    enabled: parseEnvBool(envGet(map, "CACHE_ENABLED"), false),
    driver,
    ttlSeconds,
    dir,
    redisUrl,
    defaultDir: defaultCacheDir(),
  };

  let runtimeActive = settings.enabled;
  let runtimeDriver = settings.driver;
  let runtimeTtl = settings.ttlSeconds;
  try {
    const { getJfCache } = await import("./jf-cache.js");
    const cache = getJfCache();
    runtimeActive = cache.enabled;
    runtimeDriver = settings.driver;
    runtimeTtl = settings.ttlSeconds;
  } catch {
    // cache not initialized yet
  }

  return {
    settings,
    runtime: {
      active: runtimeActive,
      driver: runtimeDriver,
      ttlSeconds: runtimeTtl,
    },
    envPath: path.join(getJfRoot(), ".env"),
  };
}

function toEnvUpdates(body: CacheSettings): Record<string, string | null> {
  const dir = body.dir?.trim() || defaultCacheDir();
  return {
    CACHE_ENABLED: body.enabled ? "1" : "0",
    CACHE_DRIVER: body.driver,
    CACHE_TTL_SECONDS: String(body.ttlSeconds),
    CACHE_DIR: body.driver === "filesystem" ? dir : null,
    CACHE_REDIS_URL: body.redisUrl?.trim() ? body.redisUrl.trim() : null,
  };
}

/** Persist cache settings to .env, reset the cache singleton, and restart the app. */
export async function applyCacheSettings(body: CacheSettings): Promise<{
  ok: boolean;
  restarting: boolean;
  restartRequired: boolean;
  settings: CacheSettingsResponse["settings"];
}> {
  const parsed = CacheSettingsBodySchema.parse(body);
  const updates = toEnvUpdates(parsed);

  await updateEnvKeys(updates);
  applyEnvToProcess(updates);

  const dir = parsed.dir?.trim() || defaultCacheDir();
  if (parsed.enabled && parsed.driver === "filesystem") {
    await fs.mkdir(dir, { recursive: true });
  }
  if (!parsed.enabled) {
    await wipeCacheStorage();
  }

  resetJfCache();

  const restart = await requestPassengerRestart(getJfRoot());
  const snapshot = await readCacheSettings();

  return {
    ok: true,
    restarting: restart.ok,
    restartRequired: !restart.ok,
    settings: snapshot.settings,
  };
}
