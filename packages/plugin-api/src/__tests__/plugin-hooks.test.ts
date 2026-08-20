import { describe, it, expect, vi } from "vitest";
import { App, type AppConfig } from "@justflows/core";
import type { PluginModule, PluginContext } from "@justflows/sdk";
import { PluginLoader } from "../loader.js";

const CONFIG = {
  env: "test",
  url: "http://localhost:3000",
  logLevel: "error",
} as unknown as AppConfig;

function makePlugin(
  overrides: Partial<PluginModule["manifest"]>,
  activate: (ctx: PluginContext) => void | Promise<void>,
): PluginModule {
  return {
    manifest: {
      id: "acme.test",
      name: "Acme Test",
      version: "1.0.0",
      license: "GPL-2.0-or-later",
      permissions: [],
      main: "index.js",
      ...overrides,
    } as PluginModule["manifest"],
    activate,
  };
}

async function activate(plugin: PluginModule): Promise<{ app: App; loader: PluginLoader }> {
  const app = new App(CONFIG);
  const loader = new PluginLoader(app);
  loader.register(plugin);
  await loader.activate(plugin.manifest.id, "site-1");
  return { app, loader };
}

describe("plugin hook context", () => {
  it("attributes a plugin's registrations to the plugin", async () => {
    const { app } = await activate(
      makePlugin({}, (ctx) => {
        ctx.hooks.action("content.published", () => {}, { id: "reindex" });
      }),
    );

    expect(app.hooks.inspect("content.published")).toEqual([
      expect.objectContaining({ pluginId: "acme.test", handlerId: "reindex" }),
    ]);
  });

  it("removes every registration on deactivation", async () => {
    const fn = vi.fn();
    const { app, loader } = await activate(
      makePlugin({}, (ctx) => {
        // Deliberately drop the dispose handles — the runtime must still clean up.
        ctx.hooks.action("content.published", fn);
        ctx.hooks.filter("content.render", (html) => html);
      }),
    );

    expect(app.hooks.count("content.published")).toBe(1);
    await loader.deactivate("acme.test", "site-1");

    await app.hooks.dispatchAction("content.published", { contentId: "c1", siteId: "site-1" });
    expect(fn).not.toHaveBeenCalled();
    expect(app.hooks.count("content.published")).toBe(0);
    expect(app.hooks.count("content.render")).toBe(0);
  });

  it("refuses a sensitive hook without the declared permission", async () => {
    await expect(
      activate(
        makePlugin({}, (ctx) => {
          ctx.hooks.action("auth.login", () => {});
        }),
      ),
    ).rejects.toThrow(/auth:hook/);
  });

  it("allows a sensitive hook once the permission is declared", async () => {
    const { app } = await activate(
      makePlugin({ permissions: ["auth:hook"] }, (ctx) => {
        ctx.hooks.action("auth.login", () => {});
      }),
    );
    expect(app.hooks.count("auth.login")).toBe(1);
  });

  it("lets a plugin emit hooks in its own namespace", async () => {
    const seen: unknown[] = [];
    const { app } = await activate(
      makePlugin({}, (ctx) => {
        ctx.hooks.action("acme.test.scored", (event) => { seen.push(event); });
        void ctx.hooks.emit("acme.test.scored", { score: 42 } as never);
      }),
    );
    await app.hooks.dispatchAction("app.started", { version: "0.1.0" });
    expect(seen).toEqual([{ score: 42 }]);
  });

  it("refuses to let a plugin emit a core hook", async () => {
    let error: unknown;
    await activate(
      makePlugin({}, async (ctx) => {
        error = await ctx.hooks.emit("content.published", {} as never).catch((e: unknown) => e);
      }),
    );
    expect(String(error)).toMatch(/own namespace/);
  });

  it("gates registered by a plugin can block a core operation", async () => {
    const { app } = await activate(
      makePlugin({}, (ctx) => {
        ctx.hooks.gate("media.beforeUpload", (event) => {
          if (event.sizeBytes > 10) event.cancel("File too large");
        });
      }),
    );

    await expect(
      app.hooks.dispatchGate("media.beforeUpload", {
        siteId: "site-1",
        filename: "big.png",
        mimeType: "image/png",
        sizeBytes: 99,
      }),
    ).rejects.toMatchObject({ reason: "File too large", pluginId: "acme.test" });
  });
});
