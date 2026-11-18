// SPDX-License-Identifier: MIT

import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sandboxSupported } from "../../../src/lib/plugins/sandbox/sandbox-host.js";
import { BROKERED_OPS, createSandboxedPluginModule, runBrokeredCall } from "../../../src/lib/plugins/sandbox/sandboxed-plugin.js";

/**
 * The sandboxed plugin as the loader sees it (justflows-ce#270): stand-ins for
 * its hooks and routes on the host's ctx, one process per site, and ctx calls
 * carried out on the host's ctx for that site only.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const hostileDir = path.resolve(here, "../../fixtures/sandbox/hostile");
const site = new AsyncLocalStorage<string>();

function fakeHost() {
  const routes = new Map<string, (req: unknown) => Promise<unknown>>();
  const filters = new Map<string, (...args: unknown[]) => unknown>();
  const gates = new Map<string, (...args: unknown[]) => unknown>();
  const store = new Map<string, unknown>();
  const calls: string[] = [];
  const ctx = {
    pluginId: "test.hostile",
    version: "1.0.0",
    runtime: {},
    permissions: new Set<string>(),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    cache: { enabled: false },
    settings: {
      get: async (key: string) => { calls.push(`settings.get ${site.getStore()}`); return `greeting for ${site.getStore()} (${key})`; },
      set: async () => undefined,
      delete: async () => undefined,
    },
    data: {
      put: async (collection: string, id: string, value: unknown) => { calls.push(`data.put ${site.getStore()}`); store.set(`${site.getStore()}:${collection}:${id}`, value); },
      get: async (collection: string, id: string) => store.get(`${site.getStore()}:${collection}:${id}`),
    },
    hooks: {
      action: () => () => undefined,
      filter: (hook: string, handler: (...args: unknown[]) => unknown) => { filters.set(hook, handler); return () => filters.delete(hook); },
      gate: (hook: string, handler: (...args: unknown[]) => unknown) => { gates.set(hook, handler); return () => gates.delete(hook); },
    },
    http: {
      url: () => "/api/plugins/test.hostile",
      get: (routePath: string, handler: (req: unknown) => Promise<unknown>) => routes.set(routePath, handler),
    },
  };
  return { ctx, routes, filters, gates, calls };
}

describe.skipIf(!sandboxSupported())("sandboxed plugin module", () => {
  it("registers stand-ins and runs each request in the process for its own site", async () => {
    const host = fakeHost();
    const module = createSandboxedPluginModule({
      manifest: { id: "test.hostile", version: "1.0.0" } as never,
      pluginDir: hostileDir,
      entry: path.join(hostileDir, "index.js"),
      currentSiteId: () => site.getStore() ?? null,
      defaultSiteId: async () => "site-a",
    });
    await site.run("site-a", () => module.activate(host.ctx as never));
    expect([...host.routes.keys()]).toContain("/data");
    expect([...host.filters.keys()]).toEqual(["test.title"]);

    const request = (siteId: string, text: string) =>
      site.run(siteId, () => host.routes.get("/data")!({ method: "GET", path: "/data", query: { text }, params: {}, headers: {}, body: null, session: null }));
    const a = (await request("site-a", "from a")) as { body: Record<string, unknown> };
    const b = (await request("site-b", "from b")) as { body: Record<string, unknown> };
    expect(a.body).toEqual({ stored: { text: "from a" }, setting: "greeting for site-a (greeting)" });
    expect(b.body).toEqual({ stored: { text: "from b" }, setting: "greeting for site-b (greeting)" });

    const pidA = ((await site.run("site-a", () => host.routes.get("/pid")!({}))) as { body: { pid: number } }).body.pid;
    const pidB = ((await site.run("site-b", () => host.routes.get("/pid")!({}))) as { body: { pid: number } }).body.pid;
    expect(pidA).not.toBe(pidB);

    expect(await site.run("site-a", () => host.filters.get("test.title")!("Home", { siteHint: "a" }, {}))).toBe("Home|filtered:a");
    let reason = "";
    await site.run("site-a", () => host.gates.get("test.save")!({ block: true, cancel: (why: string) => { reason = why; } }, {}));
    expect(reason).toBe("blocked by plugin");
    await module.deactivate?.(host.ctx as never);
  }, 30_000);
});

describe("brokered ctx calls", () => {
  it("allows only the brokered namespaces and checks arguments", async () => {
    const host = fakeHost();
    expect(BROKERED_OPS).not.toContain("users.find");
    await expect(runBrokeredCall(host.ctx as never, "users.find", [{}])).rejects.toThrow("not available");
    await expect(runBrokeredCall(host.ctx as never, "databases.probe", [])).rejects.toThrow("not available");
    await expect(runBrokeredCall(host.ctx as never, "data.get", [{}, "id"])).rejects.toThrow("collection");
    await expect(runBrokeredCall(host.ctx as never, "data.put", ["c", "id", "x".repeat(1024 * 1024 + 1)])).rejects.toThrow("too large");
    expect(await site.run("site-a", () => runBrokeredCall(host.ctx as never, "settings.get", ["greeting"]))).toBe("greeting for site-a (greeting)");
  });
});
