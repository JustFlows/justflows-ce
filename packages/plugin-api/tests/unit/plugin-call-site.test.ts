import { describe, expect, it } from "vitest";
import { App, type AppConfig } from "@justflows/core";
import type { PluginBridgeApi, PluginContext, PluginHttpResponse, PluginModule } from "@justflows/sdk";
import { PluginLoader } from "../../src/loader.js";

const CONFIG = {
  env: "test",
  url: "http://localhost:3000",
  logLevel: "error",
} as unknown as AppConfig;

const SITE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function plugin(id: string, permissions: string[], activate: (ctx: PluginContext) => void): PluginModule {
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      license: "GPL-2.0-or-later",
      permissions,
      main: "index.js",
    } as PluginModule["manifest"],
    activate,
    deleteData: async () => undefined,
  };
}

async function load(options?: {
  runForSite?: (siteId: string, fn: () => Promise<PluginHttpResponse>) => Promise<PluginHttpResponse>;
  callerPermissions?: string[];
}): Promise<PluginBridgeApi> {
  const app = new App(CONFIG);
  const loader = new PluginLoader(app, options?.runForSite ? { runForSite: options.runForSite } : {});
  let bridge: PluginBridgeApi | undefined;
  loader.register(plugin("justflows.shop", [], (ctx) => {
    ctx.http.get("orders", async () => ({ status: 200, body: { orders: [{ id: "1" }] } }));
  }));
  loader.register(plugin("justflows.helpdesk", options?.callerPermissions ?? ["platform:tenancy"], (ctx) => {
    bridge = ctx.plugins;
  }));
  await loader.activate("justflows.shop", "site-1");
  await loader.activate("justflows.helpdesk", "site-1");
  if (!bridge) throw new Error("missing bridge");
  return bridge;
}

describe("plugin calls on another site", () => {
  it("refuses a caller that cannot open another site", async () => {
    const bridge = await load({ callerPermissions: [] });
    const result = await bridge.call("justflows.shop", { method: "GET", path: "orders", siteId: SITE });
    expect(result.status).toBe(403);
  });

  it("asks the host to run the call on the named site", async () => {
    const seen: string[] = [];
    const bridge = await load({
      runForSite: async (siteId, fn) => {
        seen.push(siteId);
        return fn();
      },
    });
    const result = await bridge.call("justflows.shop", { method: "GET", path: "orders", siteId: SITE });
    expect(seen).toEqual([SITE]);
    expect(result.status).toBe(200);
  });

  it("rejects a site id that is not an id", async () => {
    const bridge = await load();
    const result = await bridge.call("justflows.shop", { method: "GET", path: "orders", siteId: "../other" });
    expect(result.status).toBe(400);
  });

  it("reports when this host cannot switch sites", async () => {
    const bridge = await load();
    const result = await bridge.call("justflows.shop", { method: "GET", path: "orders", siteId: SITE });
    expect(result.status).toBe(501);
  });
});
