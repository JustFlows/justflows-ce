import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheKeyMatchesPrefix as sdkMatches, type CacheStore, type CacheStoreDefinition } from "@justflows/sdk";
import { cacheKeyMatchesPrefix as cacheMatches, JfCache } from "@justflows/cache";
import {
  cacheStoreAdapter,
  inspectSelectedCacheStore,
  listCacheStores,
  registerCacheStore,
  resetCacheStoresForTests,
  selectCacheStore,
  selectedCacheStoreStatus,
  settleCacheStores,
  unregisterCacheStores,
} from "../../../src/lib/cache/cache-stores.js";
import { pluginCacheStoreRegistrar } from "../../../src/lib/plugins/plugin-cache.js";

const MAIN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DRIVER = "plugin:justflows.kv.shared";

/** A store whose entries live in a map that several "processes" can share. */
function memoryStore(shared: Map<string, unknown>, calls: string[] = []): CacheStore {
  return {
    async get(key) { calls.push(`get ${key}`); return shared.get(key); },
    async set(key, value, ttl) { calls.push(`set ${key} ${ttl}`); shared.set(key, JSON.parse(JSON.stringify(value))); },
    async delete(key) { shared.delete(key); },
    async invalidate(prefix) { for (const key of [...shared.keys()]) if (sdkMatches(key, prefix)) shared.delete(key); },
    async clear() { shared.clear(); },
    async has(key) { return shared.has(key); },
    status: () => ({ state: "ready" }),
    stats: async () => ({ keyCount: shared.size, sampleKeys: [...shared.keys()] }),
  };
}

function definition(create: CacheStoreDefinition["create"]): CacheStoreDefinition {
  return { id: "shared", label: "Shared store", create };
}

describe("cache stores", () => {
  beforeEach(async () => {
    await resetCacheStoresForTests(async (siteId) => siteId === MAIN);
  });
  afterEach(async () => {
    await resetCacheStoresForTests();
  });

  it("bypasses the cache until the selected store is registered", async () => {
    selectCacheStore(DRIVER, 300);
    await settleCacheStores();
    const cache = new JfCache(cacheStoreAdapter(), true);
    await cache.set("k", "v");
    expect(await cache.get("k")).toBeUndefined();
    expect(selectedCacheStoreStatus()).toMatchObject({ id: DRIVER, state: "unavailable" });

    const shared = new Map<string, unknown>();
    registerCacheStore("justflows.kv", MAIN, definition(() => memoryStore(shared)));
    await settleCacheStores();
    await cache.set("k", "v");
    expect(await cache.get("k")).toBe("v");
    expect(shared.get("k")).toBe("v");
    expect(selectedCacheStoreStatus()).toMatchObject({ state: "ready", label: "Shared store" });
    expect(listCacheStores()).toEqual([{ id: DRIVER, label: "Shared store" }]);
  });

  it("does not build an unselected store", async () => {
    const create = vi.fn(() => memoryStore(new Map()));
    registerCacheStore("justflows.kv", MAIN, definition(create));
    selectCacheStore(null, 300);
    await settleCacheStores();
    expect(create).not.toHaveBeenCalled();
    expect(selectedCacheStoreStatus()).toBeNull();
    expect(await inspectSelectedCacheStore()).toBeNull();
  });

  it("passes the default TTL when the caller gives none", async () => {
    const calls: string[] = [];
    registerCacheStore("justflows.kv", MAIN, definition(() => memoryStore(new Map(), calls)));
    selectCacheStore(DRIVER, 120);
    await settleCacheStores();
    await cacheStoreAdapter().set("a", 1);
    await cacheStoreAdapter().set("b", 1, 5);
    expect(calls).toEqual(["set a 120", "set b 5"]);
  });

  it("shares entries and invalidations between two processes", async () => {
    const shared = new Map<string, unknown>();
    registerCacheStore("justflows.kv", MAIN, definition(() => memoryStore(shared)));
    selectCacheStore(DRIVER, 300);
    await settleCacheStores();
    const first = new JfCache(cacheStoreAdapter(), true);
    /** A second process builds its own store over the same backend. */
    const second = new JfCache(memoryStoreAdapter(shared), true);
    const site = `s:${MAIN}:`;
    first.setKeyScope((key) => `${site}${key}`);
    second.setKeyScope((key) => `${site}${key}`);

    await first.set("page:html:/about", "<about>");
    expect(await second.get("page:html:/about")).toBe("<about>");
    await second.invalidate("page:html:");
    expect(await first.get("page:html:/about")).toBeUndefined();
  });

  it("refuses a store registered from a site other than the main site", async () => {
    const create = vi.fn(() => memoryStore(new Map()));
    registerCacheStore("justflows.kv", OTHER, definition(create));
    selectCacheStore(DRIVER, 300);
    await settleCacheStores();
    expect(create).not.toHaveBeenCalled();
    expect(selectedCacheStoreStatus()).toMatchObject({ state: "unavailable" });
    expect(selectedCacheStoreStatus()?.detail).toMatch(/main site/);
  });

  it("reports a store that cannot be configured and stays bypassed", async () => {
    registerCacheStore("justflows.kv", MAIN, definition(() => {
      throw new Error("Set KV_URL");
    }));
    selectCacheStore(DRIVER, 300);
    await settleCacheStores();
    expect(selectedCacheStoreStatus()).toMatchObject({ state: "unavailable", detail: "Set KV_URL" });
    await cacheStoreAdapter().set("k", "v");
    expect(await cacheStoreAdapter().get("k")).toBeUndefined();
  });

  it("closes the store and bypasses again when its plugin deactivates", async () => {
    const shared = new Map<string, unknown>();
    const close = vi.fn(async () => undefined);
    registerCacheStore("justflows.kv", MAIN, definition(() => ({ ...memoryStore(shared), close })));
    selectCacheStore(DRIVER, 300);
    await settleCacheStores();
    await cacheStoreAdapter().set("k", "v");

    unregisterCacheStores("justflows.kv");
    await settleCacheStores();
    expect(close).toHaveBeenCalledTimes(1);
    expect(await cacheStoreAdapter().get("k")).toBeUndefined();
    expect(selectedCacheStoreStatus()?.detail).toMatch(/No active plugin/);
  });

  it("turns store failures into misses instead of request errors", async () => {
    const failing: CacheStore = {
      ...memoryStore(new Map()),
      get: async () => { throw new Error("ECONNREFUSED"); },
      invalidate: async () => { throw new Error("ECONNREFUSED"); },
      clear: async () => { throw new Error("ECONNREFUSED"); },
    };
    registerCacheStore("justflows.kv", MAIN, definition(() => failing));
    selectCacheStore(DRIVER, 300);
    await settleCacheStores();
    const cache = new JfCache(cacheStoreAdapter(), true);
    await expect(cache.remember("k", 60, async () => "fresh")).resolves.toBe("fresh");
    await cache.invalidate("content:");
    expect(selectedCacheStoreStatus()).toMatchObject({ state: "unavailable" });
    expect(selectedCacheStoreStatus()?.detail).toMatch(/invalidation/);
  });

  it("reports store stats for Admin → Tools", async () => {
    const shared = new Map<string, unknown>([["a", 1]]);
    registerCacheStore("justflows.kv", MAIN, definition(() => memoryStore(shared)));
    selectCacheStore(DRIVER, 300);
    await settleCacheStores();
    expect(await inspectSelectedCacheStore()).toEqual({ keyCount: 1, totalBytes: 0, sampleKeys: ["a"] });
  });

  it("rejects malformed and duplicate registrations", () => {
    const create = () => memoryStore(new Map());
    expect(() => registerCacheStore("justflows.kv", MAIN, { id: "Bad Id", label: "x", create })).toThrow(/kebab-case/);
    expect(() => registerCacheStore("justflows.kv", MAIN, { id: "ok", label: "", create })).toThrow(/label/);
    registerCacheStore("justflows.kv", MAIN, { id: "ok", label: "Ok", create });
    expect(() => registerCacheStore("justflows.kv", MAIN, { id: "ok", label: "Ok", create })).toThrow(/already/);
  });

  it("requires the cache:store permission", () => {
    const create = () => memoryStore(new Map());
    const without = pluginCacheStoreRegistrar("justflows.kv", new Set(), MAIN);
    expect(() => without({ id: "shared", label: "Shared", create })).toThrow(/cache:store/);
    const withPermission = pluginCacheStoreRegistrar("justflows.kv", new Set(["cache:store"]), MAIN);
    withPermission({ id: "shared", label: "Shared", create });
    expect(listCacheStores()).toEqual([{ id: DRIVER, label: "Shared" }]);
  });
});

describe("cache key prefix semantics", () => {
  it("are the same in the SDK and @justflows/cache", () => {
    const keys = [
      "page:html:/a",
      `s:${MAIN}:page:html:/a`,
      `s:${OTHER}:page:html:/a`,
      `s:${MAIN}:content:x`,
      "plugin:justflows.kv:x",
    ];
    const prefixes = ["page:html:", `s:${MAIN}:page:html:`, `s:${MAIN}:`, "content:", "plugin:", ""];
    for (const key of keys) {
      for (const prefix of prefixes) {
        expect(sdkMatches(key, prefix), `${key} / ${prefix}`).toBe(cacheMatches(key, prefix));
      }
    }
  });
});

/** A plain adapter over the shared map, as a second process would hold. */
function memoryStoreAdapter(shared: Map<string, unknown>) {
  const store = memoryStore(shared);
  return {
    get: async <T>(key: string) => (await store.get(key)) as T | undefined,
    set: (key: string, value: unknown, ttl?: number) => store.set(key, value, ttl ?? 300),
    delete: (key: string) => store.delete(key),
    invalidate: (prefix: string) => store.invalidate(prefix),
    clear: () => store.clear(),
    has: (key: string) => store.has(key),
  };
}
