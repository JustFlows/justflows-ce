import { describe, it, expect, vi } from "vitest";
import { App, type AppConfig } from "@justflows/core";
import type { PluginModule, PluginContext } from "@justflows/sdk";
import { PluginLoader } from "../../src/loader.js";

const CONFIG = {
  env: "test",
  url: "http://localhost:3000",
  logLevel: "error",
} as unknown as AppConfig;

function makePlugin(activate: (ctx: PluginContext) => void | Promise<void>): PluginModule {
  return {
    manifest: {
      id: "justflows.test",
      name: "Acme Test",
      version: "1.0.0",
      license: "GPL-2.0-or-later",
      permissions: [],
      main: "index.js",
    } as PluginModule["manifest"],
    activate,
    deleteData: async () => undefined,
  };
}

async function activate(
  plugin: PluginModule,
): Promise<{ app: App; reporter: ReturnType<typeof vi.fn> }> {
  const app = new App(CONFIG);
  const reporter = vi.fn();
  const loader = new PluginLoader(app, { errorReporter: reporter });
  loader.register(plugin);
  await loader.activate(plugin.manifest.id, "site-1");
  return { app, reporter };
}

describe("plugin error reporting", () => {
  it("forwards ctx.logger.error to the host reporter", async () => {
    let seen: PluginContext | undefined;
    const { reporter } = await activate(
      makePlugin((ctx) => {
        seen = ctx;
      }),
    );
    seen?.logger.error("Shop catalog load failed", { error: "Error: db down" });
    seen?.logger.warn("not an error");
    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter).toHaveBeenCalledWith("justflows.test", "Shop catalog load failed", "Error: db down");
  });

  it("reports and rethrows failing action handlers", async () => {
    const { app, reporter } = await activate(
      makePlugin((ctx) => {
        ctx.hooks.action("content.published", async () => {
          throw new Error("boom");
        });
      }),
    );
    await app.hooks.dispatchAction("content.published", { contentId: "c1", siteId: "site-1" });
    expect(reporter).toHaveBeenCalledWith(
      "justflows.test",
      "hook:content.published",
      expect.objectContaining({ message: "boom" }),
    );
    expect(app.hooks.inspect("content.published")[0]).toEqual(
      expect.objectContaining({ errors: 1 }),
    );
  });

  it("keeps sync filters synchronous", async () => {
    const { app, reporter } = await activate(
      makePlugin((ctx) => {
        ctx.hooks.filter("content.render", (html: string) => `${html}!`);
      }),
    );
    expect(app.hooks.applyFilterSync("content.render", "hi", {})).toBe("hi!");
    expect(reporter).not.toHaveBeenCalled();
  });

  it("never lets a broken reporter break the plugin", async () => {
    const app = new App(CONFIG);
    let seen: PluginContext | undefined;
    const loader = new PluginLoader(app, {
      errorReporter: () => {
        throw new Error("reporter down");
      },
    });
    const plugin = makePlugin((ctx) => {
      seen = ctx;
    });
    loader.register(plugin);
    await loader.activate(plugin.manifest.id, "site-1");
    expect(() => seen?.logger.error("x")).not.toThrow();
  });
});
