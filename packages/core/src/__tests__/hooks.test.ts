import { describe, it, expect, vi } from "vitest";
import { HooksRegistry } from "../hooks/registry.js";
import { HookAbortError } from "../hooks/errors.js";

/** Registry with logging silenced so failure tests do not spam the reporter. */
function makeRegistry(options: ConstructorParameters<typeof HooksRegistry>[0] = {}) {
  const logs: Array<{ level: string; message: string; context?: Record<string, unknown> }> = [];
  const record =
    (level: string) =>
    (message: string, context?: Record<string, unknown>): void => {
      logs.push(context === undefined ? { level, message } : { level, message, context });
    };
  const logger = {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    child: () => logger,
  };
  return { hooks: new HooksRegistry({ logger, ...options }), logs };
}

describe("HooksRegistry — actions", () => {
  it("dispatches to every registered handler", async () => {
    const { hooks } = makeRegistry();
    const calls: string[] = [];
    hooks.action("test.event", () => { calls.push("a"); });
    hooks.action("test.event", () => { calls.push("b"); });
    await hooks.dispatchAction("test.event", {});
    expect(calls).toEqual(["a", "b"]);
  });

  it("runs handlers in priority order, ties by registration order", async () => {
    const { hooks } = makeRegistry();
    const calls: number[] = [];
    hooks.action("test.order", () => { calls.push(3); }, { priority: 200 });
    hooks.action("test.order", () => { calls.push(1); }, { priority: 50 });
    hooks.action("test.order", () => { calls.push(4); }, { priority: 200 });
    hooks.action("test.order", () => { calls.push(2); });
    await hooks.dispatchAction("test.order", {});
    expect(calls).toEqual([1, 2, 3, 4]);
  });

  it("passes the hook context as the second argument", async () => {
    const { hooks } = makeRegistry();
    const seen: unknown[] = [];
    hooks.action("test.ctx", (_event, ctx) => { seen.push(ctx); });
    await hooks.dispatchAction("test.ctx", {}, { siteId: "site-1", source: "http" });
    expect(seen).toEqual([{ siteId: "site-1", source: "http" }]);
  });

  it("completes synchronously when every handler is synchronous", () => {
    const { hooks } = makeRegistry();
    const calls: string[] = [];
    hooks.action("test.sync", () => { calls.push("ran"); });
    // The returned promise is already settled; the handler ran before we await.
    void hooks.dispatchAction("test.sync", {});
    expect(calls).toEqual(["ran"]);
  });

  it("awaits async handlers before running later ones", async () => {
    const { hooks } = makeRegistry();
    const calls: string[] = [];
    hooks.action("test.mixed", async () => {
      await Promise.resolve();
      calls.push("slow");
    });
    hooks.action("test.mixed", () => { calls.push("fast"); });
    await hooks.dispatchAction("test.mixed", {});
    expect(calls).toEqual(["slow", "fast"]);
  });

  it("isolates handler failures and keeps going", async () => {
    const { hooks, logs } = makeRegistry();
    const second = vi.fn();
    hooks.action("test.error", () => { throw new Error("boom"); }, { pluginId: "acme.bad" });
    hooks.action("test.error", second);
    await expect(hooks.dispatchAction("test.error", {})).resolves.toBeUndefined();
    expect(second).toHaveBeenCalled();
    expect(logs.some((l) => l.level === "error" && l.context?.["pluginId"] === "acme.bad")).toBe(true);
  });

  it("isolates rejected async handlers", async () => {
    const { hooks } = makeRegistry();
    const second = vi.fn();
    hooks.action("test.reject", async () => { throw new Error("boom"); });
    hooks.action("test.reject", second);
    await expect(hooks.dispatchAction("test.reject", {})).resolves.toBeUndefined();
    expect(second).toHaveBeenCalled();
  });

  it("dispose removes the handler", async () => {
    const { hooks } = makeRegistry();
    const fn = vi.fn();
    const dispose = hooks.action("test.dispose", fn);
    dispose();
    dispose(); // idempotent
    await hooks.dispatchAction("test.dispose", {});
    expect(fn).not.toHaveBeenCalled();
  });

  it("once handlers run exactly once", async () => {
    const { hooks } = makeRegistry();
    const fn = vi.fn();
    hooks.action("test.once", fn, { once: true });
    await hooks.dispatchAction("test.once", {});
    await hooks.dispatchAction("test.once", {});
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("registering during a dispatch does not affect the in-flight run", async () => {
    const { hooks } = makeRegistry();
    const late = vi.fn();
    hooks.action("test.reentrant", () => { hooks.action("test.reentrant", late); });
    await hooks.dispatchAction("test.reentrant", {});
    expect(late).not.toHaveBeenCalled();
    await hooks.dispatchAction("test.reentrant", {});
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("disposing during a dispatch skips the not-yet-run handler", async () => {
    const { hooks } = makeRegistry();
    const later = vi.fn();
    const dispose = hooks.action("test.cancelnext", later, { priority: 200 });
    hooks.action("test.cancelnext", () => { dispose(); }, { priority: 100 });
    await hooks.dispatchAction("test.cancelnext", {});
    expect(later).not.toHaveBeenCalled();
  });

  it("refuses unbounded recursion", async () => {
    const { hooks, logs } = makeRegistry({ maxDepth: 4 });
    let depth = 0;
    hooks.action("test.loop", () => {
      depth++;
      void hooks.dispatchAction("test.loop", {});
    });
    await hooks.dispatchAction("test.loop", {});
    expect(depth).toBe(4);
    expect(logs.some((l) => l.message.includes("recursion"))).toBe(true);
  });

  it("disables a handler after repeated failures", async () => {
    const { hooks, logs } = makeRegistry({ failureThreshold: 3 });
    const fn = vi.fn(() => { throw new Error("always"); });
    hooks.action("test.breaker", fn, { pluginId: "acme.bad" });
    for (let i = 0; i < 5; i++) await hooks.dispatchAction("test.breaker", {});
    expect(fn).toHaveBeenCalledTimes(3);
    expect(logs.some((l) => l.message.includes("disabled"))).toBe(true);
  });

  it("dispatchActionSync reports async handlers instead of dropping them silently", () => {
    const { hooks, logs } = makeRegistry();
    hooks.action("test.syncOnly", async () => { await Promise.resolve(); });
    hooks.dispatchActionSync("test.syncOnly", {});
    expect(logs.some((l) => l.level === "error" && l.message.includes("synchronous hook"))).toBe(true);
  });

  it("costs nothing when nobody is listening", async () => {
    const { hooks } = makeRegistry();
    await expect(hooks.dispatchAction("test.nobody", {})).resolves.toBeUndefined();
    expect(hooks.has("test.nobody")).toBe(false);
    expect(hooks.didAction("test.nobody")).toBe(1);
  });
});

describe("HooksRegistry — gates", () => {
  it("runs to completion when nothing cancels", async () => {
    const { hooks } = makeRegistry();
    hooks.gate("test.before", () => {});
    await expect(hooks.dispatchGate("test.before", { id: "1" })).resolves.toBeUndefined();
  });

  it("cancel() aborts with the reason and the responsible plugin", async () => {
    const { hooks } = makeRegistry();
    hooks.gate<{ id: string }>("test.before", (event) => { event.cancel("Not allowed"); }, {
      pluginId: "acme.guard",
    });
    await expect(hooks.dispatchGate("test.before", { id: "1" })).rejects.toMatchObject({
      name: "HookAbortError",
      reason: "Not allowed",
      pluginId: "acme.guard",
      hook: "test.before",
    });
  });

  it("fails closed when a gate handler throws", async () => {
    const { hooks } = makeRegistry();
    hooks.gate("test.before", () => { throw new Error("validator crashed"); }, {
      pluginId: "acme.guard",
    });
    const err = await hooks.dispatchGate("test.before", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HookAbortError);
    expect((err as HookAbortError).reason).toContain("validator crashed");
  });

  it("stops the chain at the first cancellation", async () => {
    const { hooks } = makeRegistry();
    const later = vi.fn();
    hooks.gate<Record<string, never>>("test.before", (e) => { e.cancel("stop"); }, { priority: 10 });
    hooks.gate("test.before", later, { priority: 20 });
    await expect(hooks.dispatchGate("test.before", {})).rejects.toBeInstanceOf(HookAbortError);
    expect(later).not.toHaveBeenCalled();
  });

  it("supports async gate handlers", async () => {
    const { hooks } = makeRegistry();
    hooks.gate<Record<string, never>>("test.before", async (e) => {
      await Promise.resolve();
      e.cancel("async veto");
    });
    await expect(hooks.dispatchGate("test.before", {})).rejects.toMatchObject({
      reason: "async veto",
    });
  });

  it("exposes the event payload to the handler", async () => {
    const { hooks } = makeRegistry();
    let seen = "";
    hooks.gate<{ filename: string }>("test.before", (e) => { seen = e.filename; });
    await hooks.dispatchGate("test.before", { filename: "cat.png" });
    expect(seen).toBe("cat.png");
  });
});

describe("HooksRegistry — filters", () => {
  it("applies handlers in sequence", async () => {
    const { hooks } = makeRegistry();
    hooks.filter("test.filter", (v: number) => v + 1);
    hooks.filter("test.filter", (v: number) => v * 2);
    expect(await hooks.applyFilter("test.filter", 3, {})).toBe(8);
  });

  it("applies synchronously via applyFilterSync", () => {
    const { hooks } = makeRegistry();
    hooks.filter("test.sync", (v: string) => `${v}!`);
    expect(hooks.applyFilterSync("test.sync", "hi", {})).toBe("hi!");
  });

  it("supports async handlers in the async pipeline", async () => {
    const { hooks } = makeRegistry();
    hooks.filter("test.async", async (v: number) => v + 1);
    hooks.filter("test.async", (v: number) => v * 10);
    expect(await hooks.applyFilter("test.async", 1, {})).toBe(20);
  });

  it("keeps the previous value when a handler forgets to return", async () => {
    const { hooks, logs } = makeRegistry();
    hooks.filter("test.forgot", (v: string) => v.toUpperCase());
    hooks.filter("test.forgot", (() => undefined) as never, { pluginId: "acme.sloppy" });
    hooks.filter("test.forgot", (v: string) => `${v}.`);
    expect(await hooks.applyFilter("test.forgot", "ok", {})).toBe("OK.");
    expect(logs.some((l) => l.level === "warn" && l.message.includes("undefined"))).toBe(true);
  });

  it("keeps the last good value when a handler throws", async () => {
    const { hooks } = makeRegistry();
    hooks.filter("test.throws", (v: string) => `${v}-a`);
    hooks.filter("test.throws", () => { throw new Error("boom"); });
    hooks.filter("test.throws", (v: string) => `${v}-b`);
    expect(await hooks.applyFilter("test.throws", "x", {})).toBe("x-a-b");
  });

  it("skips async handlers on a synchronous pipeline rather than leaking a promise", () => {
    const { hooks, logs } = makeRegistry();
    hooks.filter("test.syncpipe", (v: string) => `${v}1`);
    hooks.filter("test.syncpipe", async (v: string) => `${v}2`);
    hooks.filter("test.syncpipe", (v: string) => `${v}3`);
    expect(hooks.applyFilterSync("test.syncpipe", "v", {})).toBe("v13");
    expect(logs.some((l) => l.message.includes("synchronous hook"))).toBe(true);
  });

  it("returns the input untouched when nobody is listening", async () => {
    const { hooks } = makeRegistry();
    expect(await hooks.applyFilter("test.none", "value", {})).toBe("value");
    expect(hooks.applyFilterSync("test.none", "value", {})).toBe("value");
  });

  it("passes filter context and hook context through", async () => {
    const { hooks } = makeRegistry();
    const seen: unknown[] = [];
    hooks.filter("test.ctx", (v: string, ctx: unknown, hookCtx) => {
      seen.push(ctx, hookCtx);
      return v;
    });
    await hooks.applyFilter("test.ctx", "v", { contentId: "c1" }, { siteId: "s1" });
    expect(seen).toEqual([{ contentId: "c1" }, { siteId: "s1" }]);
  });
});

describe("HooksRegistry — lifecycle and introspection", () => {
  it("removePlugin drops every handler owned by the plugin", async () => {
    const { hooks } = makeRegistry();
    const pluginFn = vi.fn();
    const coreFn = vi.fn();
    hooks.action("test.plugin", pluginFn, { pluginId: "acme.seo" });
    hooks.filter("test.plugin.filter", ((v: string) => v) as never, { pluginId: "acme.seo" });
    hooks.action("test.plugin", coreFn);

    expect(hooks.removePlugin("acme.seo")).toBe(2);
    await hooks.dispatchAction("test.plugin", {});
    expect(pluginFn).not.toHaveBeenCalled();
    expect(coreFn).toHaveBeenCalled();
  });

  it("counts handlers and dispatches", async () => {
    const { hooks } = makeRegistry();
    hooks.action("test.count", () => {});
    hooks.filter("test.count", ((v: unknown) => v) as never);
    expect(hooks.count("test.count")).toBe(2);
    expect(hooks.has("test.count")).toBe(true);
    await hooks.dispatchAction("test.count", {});
    await hooks.dispatchAction("test.count", {});
    expect(hooks.didAction("test.count")).toBe(2);
  });

  it("inspect reports owner, priority and error counts", async () => {
    const { hooks } = makeRegistry();
    hooks.action("test.inspect", () => { throw new Error("x"); }, {
      pluginId: "acme.seo",
      id: "on-publish",
      priority: 20,
    });
    await hooks.dispatchAction("test.inspect", {});
    const [entry] = hooks.inspect("test.inspect");
    expect(entry).toMatchObject({
      hook: "test.inspect",
      kind: "action",
      pluginId: "acme.seo",
      handlerId: "on-publish",
      priority: 20,
      errors: 1,
      disabled: false,
    });
  });

  it("clear removes everything", async () => {
    const { hooks } = makeRegistry();
    const fn = vi.fn();
    hooks.action("test.clear", fn);
    hooks.clear();
    await hooks.dispatchAction("test.clear", {});
    expect(fn).not.toHaveBeenCalled();
    expect(hooks.inspect()).toEqual([]);
  });

  it("rejects a non-function handler", () => {
    const { hooks } = makeRegistry();
    expect(() => hooks.action("test.bad", undefined as never)).toThrow(TypeError);
  });
});
