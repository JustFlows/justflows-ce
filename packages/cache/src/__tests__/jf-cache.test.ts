import { describe, it, expect, vi } from "vitest";
import { MemoryCache } from "../memory.js";
import { NullCache } from "../null.js";
import { JfCache } from "../jf-cache.js";
import { createJfCache } from "../factory.js";

describe("NullCache", () => {
  it("always misses on get", async () => {
    const cache = new NullCache();
    await cache.set("key", "value");
    expect(await cache.get("key")).toBeUndefined();
  });
});

describe("JfCache", () => {
  it("remember stores and returns cached values", async () => {
    const cache = new JfCache(new MemoryCache(60), true);
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      return { ok: true };
    });

    expect(await cache.remember("test", 60, fn)).toEqual({ ok: true });
    expect(await cache.remember("test", 60, fn)).toEqual({ ok: true });
    expect(calls).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("remember always fetches when disabled", async () => {
    const cache = new JfCache(new NullCache(), false);
    let calls = 0;
    const fn = async () => {
      calls++;
      return 42;
    };

    expect(await cache.remember("test", 60, fn)).toBe(42);
    expect(await cache.remember("test", 60, fn)).toBe(42);
    expect(calls).toBe(2);
  });

  it("deduplicates concurrent remember calls", async () => {
    const cache = new JfCache(new MemoryCache(60), true);
    let calls = 0;
    const fn = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return "done";
    };

    const [a, b] = await Promise.all([
      cache.remember("concurrent", 60, fn),
      cache.remember("concurrent", 60, fn),
    ]);

    expect(a).toBe("done");
    expect(b).toBe("done");
    expect(calls).toBe(1);
  });
});

describe("createJfCache", () => {
  it("returns disabled cache when enabled=false", () => {
    const cache = createJfCache({ driver: "memory", enabled: false });
    expect(cache.enabled).toBe(false);
  });
});
