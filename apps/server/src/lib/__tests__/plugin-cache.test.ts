import { describe, it, expect, beforeEach } from "vitest";
import { createJfCache } from "@justflows/cache";
import { createPluginCacheApi, pluginCachePrefix } from "../plugin-cache.js";

describe("createPluginCacheApi", () => {
  const cache = createJfCache({ driver: "memory", enabled: true, ttlSeconds: 60 });

  beforeEach(async () => {
    await cache.clear();
  });

  it("scopes keys under plugin:{id}:", async () => {
    const api = createPluginCacheApi("acme.shop", cache);
    await api.set("products", [{ id: 1 }]);

    expect(await cache.get("plugin:acme.shop:products")).toEqual([{ id: 1 }]);
    expect(await api.get("products")).toEqual([{ id: 1 }]);
  });

  it("cannot read another plugin's keys", async () => {
    const a = createPluginCacheApi("acme.a", cache);
    const b = createPluginCacheApi("acme.b", cache);
    await a.set("secret", "x");
    expect(await b.get("secret")).toBeUndefined();
  });

  it("invalidate only clears the plugin namespace", async () => {
    const api = createPluginCacheApi("acme.shop", cache);
    await cache.set("content:published:home:", "core");
    await api.set("x", 1);
    await api.invalidate();

    expect(await api.get("x")).toBeUndefined();
    expect(await cache.get("content:published:home:")).toBe("core");
    expect(pluginCachePrefix("acme.shop")).toBe("plugin:acme.shop:");
  });

  it("rejects empty or unsafe keys", async () => {
    const api = createPluginCacheApi("acme.shop", cache);
    expect(() => { void api.set("", 1); }).toThrow(/empty/);
    expect(() => { void api.set("plugin:other:x", 1); }).toThrow();
  });
});
