import type { CacheStoreDefinition, PluginCacheApi, PluginPermission } from "@justflows/sdk";
import type { JfCache } from "@justflows/cache";
import { registerCacheStore } from "../cache/cache-stores.js";

/**
 * `ctx.cache.registerStore` for one plugin: requires `cache:store`, and records
 * the site the plugin is active on so only a main-site plugin can back the cache.
 */
export function pluginCacheStoreRegistrar(
  pluginId: string,
  permissions: ReadonlySet<PluginPermission>,
  siteId: string,
): (definition: CacheStoreDefinition) => void {
  return (definition) => {
    if (!permissions.has("cache:store")) {
      throw new Error(`Plugin "${pluginId}" requires the cache:store permission`);
    }
    registerCacheStore(pluginId, siteId, definition);
  };
}

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
 * `registerStore` is present when the host passes one (it checks `cache:store`).
 */
export function createPluginCacheApi(
  pluginId: string,
  cache: JfCache,
  registerStore?: (definition: CacheStoreDefinition) => void,
): PluginCacheApi {
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

    ...(registerStore ? { registerStore } : {}),
  };
}
