import type { PluginCacheApi } from "@justflows/sdk";
import type { JfCache } from "@justflows/cache";

/** Force every plugin key under `plugin:{pluginId}:…`. */
export function pluginCachePrefix(pluginId: string): string {
  return `plugin:${pluginId}:`;
}

function scopedKey(pluginId: string, key: string): string {
  const trimmed = key.replace(/^\/+/, "").trim();
  if (!trimmed) {
    throw new Error("Cache key must not be empty");
  }
  if (trimmed.includes("..") || trimmed.startsWith("plugin:")) {
    throw new Error("Invalid cache key");
  }
  return `${pluginCachePrefix(pluginId)}${trimmed}`;
}

/**
 * Wrap the shared jf-cache so a plugin can only touch its own key namespace.
 */
export function createPluginCacheApi(pluginId: string, cache: JfCache): PluginCacheApi {
  const root = pluginCachePrefix(pluginId);

  return {
    get enabled() {
      return cache.enabled;
    },

    remember<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
      return cache.remember(scopedKey(pluginId, key), ttlSeconds, fn);
    },

    get<T = unknown>(key: string): Promise<T | undefined> {
      return cache.get<T>(scopedKey(pluginId, key));
    },

    set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
      return cache.set(scopedKey(pluginId, key), value, ttlSeconds);
    },

    delete(key: string): Promise<void> {
      return cache.delete(scopedKey(pluginId, key));
    },

    invalidate(prefix?: string): Promise<void> {
      const target = prefix?.trim()
        ? scopedKey(pluginId, prefix.trim())
        : root;
      return cache.invalidate(target);
    },
  };
}
