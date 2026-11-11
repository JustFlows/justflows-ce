import { describe, expect, it, vi } from "vitest";
import type { CacheAdapter } from "../../src/adapter.js";
import { DelegatingCache } from "../../src/delegating.js";
import { GuardedCache } from "../../src/guarded.js";
import { MemoryCache } from "../../src/memory.js";
import { JfCache } from "../../src/jf-cache.js";
import { createJfCache } from "../../src/factory.js";

/** A memory backend that can be switched off to simulate an outage. */
class FlakyStore implements CacheAdapter {
  readonly memory = new MemoryCache(60);
  down = false;
  hang = false;
  clears = 0;

  private async gate(): Promise<void> {
    if (this.hang) await new Promise(() => undefined);
    if (this.down) throw new Error("connection refused");
  }
  async get<T>(key: string) { await this.gate(); return this.memory.get<T>(key); }
  async set<T>(key: string, value: T, ttl?: number) { await this.gate(); await this.memory.set(key, value, ttl); }
  async delete(key: string) { await this.gate(); await this.memory.delete(key); }
  async invalidate(prefix: string) { await this.gate(); await this.memory.invalidate(prefix); }
  async clear() { await this.gate(); this.clears++; await this.memory.clear(); }
  async has(key: string) { await this.gate(); return this.memory.has(key); }
}

describe("GuardedCache", () => {
  it("passes calls through while the backend is healthy", async () => {
    const store = new FlakyStore();
    const cache = new GuardedCache(store);
    await cache.set("a", 1);
    expect(await cache.get("a")).toBe(1);
    expect(await cache.has("a")).toBe(true);
    await cache.delete("a");
    expect(await cache.get("a")).toBeUndefined();
    expect(cache.degraded).toBe(false);
  });

  it("turns a failed read into a miss and a failed write into a skip", async () => {
    const store = new FlakyStore();
    const onError = vi.fn();
    const cache = new GuardedCache(store, { onError });
    store.down = true;
    expect(await cache.get("a")).toBeUndefined();
    expect(await cache.has("a")).toBe(false);
    await expect(cache.set("a", 1)).resolves.toBeUndefined();
    expect(onError.mock.calls.map(([op]) => op)).toEqual(["get", "has", "set"]);
    /** Reads and writes alone never put the guard into bypass. */
    expect(cache.degraded).toBe(false);
  });

  it("treats a backend that does not answer as failed", async () => {
    const store = new FlakyStore();
    const cache = new GuardedCache(store, { timeoutMs: 20, bulkTimeoutMs: 40 });
    store.hang = true;
    expect(await cache.get("a")).toBeUndefined();
    await cache.invalidate("page:");
    expect(cache.degraded).toBe(true);
  });

  it("bypasses after a lost invalidation and flushes before serving again", async () => {
    let now = 1_000;
    const store = new FlakyStore();
    const cache = new GuardedCache(store, { retryDelayMs: 5_000, now: () => now });
    await cache.set("page:html:/about", "<old>");

    store.down = true;
    await cache.invalidate("page:html:");
    expect(cache.degraded).toBe(true);

    /** The backend is back, but the entry that should be gone is still there. */
    store.down = false;
    expect(await store.memory.get("page:html:/about")).toBe("<old>");
    /** Within the retry delay the guard keeps bypassing. */
    expect(await cache.get("page:html:/about")).toBeUndefined();
    expect(store.clears).toBe(0);

    now += 5_000;
    expect(await cache.get("page:html:/about")).toBeUndefined();
    expect(store.clears).toBe(1);
    expect(cache.degraded).toBe(false);
    await cache.set("page:html:/about", "<new>");
    expect(await cache.get("page:html:/about")).toBe("<new>");
  });

  it("keeps bypassing while recovery fails and retries later", async () => {
    let now = 0;
    const store = new FlakyStore();
    const cache = new GuardedCache(store, { retryDelayMs: 100, now: () => now });
    store.down = true;
    await cache.delete("x");
    now += 100;
    expect(await cache.get("x")).toBeUndefined();
    expect(cache.degraded).toBe(true);
    store.down = false;
    now += 100;
    await cache.set("x", 1);
    expect(cache.degraded).toBe(false);
    expect(await cache.get("x")).toBe(1);
  });

  it("an explicit clear ends the bypass", async () => {
    const store = new FlakyStore();
    const cache = new GuardedCache(store, { retryDelayMs: 60_000 });
    store.down = true;
    await cache.clear();
    expect(cache.degraded).toBe(true);
    store.down = false;
    await cache.clear();
    expect(cache.degraded).toBe(false);
  });

  it("keeps JfCache.remember working through an outage", async () => {
    const store = new FlakyStore();
    const cache = new JfCache(new GuardedCache(store), true);
    store.down = true;
    const fn = vi.fn(async () => "fresh");
    expect(await cache.remember("k", 60, fn)).toBe("fresh");
    expect(await cache.remember("k", 60, fn)).toBe("fresh");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("DelegatingCache", () => {
  it("bypasses until a backend is attached, and again after it is removed", async () => {
    const delegating = new DelegatingCache();
    expect(delegating.bypassing).toBe(true);
    await delegating.set("a", 1);
    expect(await delegating.get("a")).toBeUndefined();

    const backend = new MemoryCache(60);
    delegating.use(backend);
    expect(delegating.bypassing).toBe(false);
    await delegating.set("a", 1);
    expect(await delegating.get("a")).toBe(1);

    delegating.use(null);
    expect(await delegating.get("a")).toBeUndefined();
    expect(await backend.get("a")).toBe(1);
  });

  it("lets createJfCache use a supplied adapter", async () => {
    const delegating = new DelegatingCache();
    const backend = new MemoryCache(60);
    delegating.use(backend);
    const cache = createJfCache({ adapter: delegating, enabled: true });
    await cache.set("k", "v");
    expect(await backend.get("k")).toBe("v");
  });
});
