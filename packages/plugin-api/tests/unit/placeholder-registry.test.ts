import { describe, expect, it } from "vitest";
import { App, type AppConfig } from "@justflows/core";
import type { PluginContext, PluginModule } from "@justflows/sdk";
import { PluginLoader } from "../../src/loader.js";
import { PluginPlaceholderRegistry, placeholderImgHtml } from "../../src/placeholder-registry.js";

const CONFIG = {
  env: "test",
  url: "http://localhost:3000",
  logLevel: "error",
} as unknown as AppConfig;

const PRODUCT = { src: "/ext/justflows.shop/product.svg", width: 800, height: 800 };

function plugin(id: string, activate: (ctx: PluginContext) => void): PluginModule {
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      license: "GPL-2.0-or-later",
      permissions: [],
      main: "index.js",
    } as PluginModule["manifest"],
    activate,
    deleteData: async () => undefined,
  };
}

describe("PluginPlaceholderRegistry", () => {
  it("accepts kinds only under the plugin's own namespace", () => {
    const registry = new PluginPlaceholderRegistry();
    registry.register("justflows.shop", "justflows.shop.product", PRODUCT);
    expect(registry.get("justflows.shop.product")).toMatchObject({ pluginId: "justflows.shop" });
    expect(() => registry.register("justflows.shop", "featured", PRODUCT)).toThrow(/namespace/);
    expect(() => registry.register("justflows.shop", "justflows.other.x", PRODUCT)).toThrow(
      /namespace/,
    );
  });

  it("validates the image", () => {
    const registry = new PluginPlaceholderRegistry();
    for (const src of ["javascript:alert(1)", "//evil.example.com/x.png", "http://x.example/x.png"]) {
      expect(() =>
        registry.register("justflows.shop", "justflows.shop.product", { ...PRODUCT, src }),
      ).toThrow(/invalid placeholder/);
    }
    expect(() =>
      registry.register("justflows.shop", "justflows.shop.product", { ...PRODUCT, width: 0 }),
    ).toThrow(/invalid placeholder/);
  });

  it("drops a plugin's kinds on removePlugin and via the returned disposer", () => {
    const registry = new PluginPlaceholderRegistry();
    const dispose = registry.register("justflows.shop", "justflows.shop.product", PRODUCT);
    registry.register("justflows.shop", "justflows.shop.category", PRODUCT);
    dispose();
    expect(registry.get("justflows.shop.product")).toBeUndefined();
    registry.removePlugin("justflows.shop");
    expect(registry.all()).toEqual([]);
  });
});

describe("placeholderImgHtml", () => {
  it("escapes every attribute", () => {
    const html = placeholderImgHtml(
      { kind: "featured", src: '/p.svg?"><script>', width: 10, height: 20, source: "core" },
      { alt: 'a"b', className: "c<d" },
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain('alt="a&quot;b"');
    expect(html).toContain('class="jf-placeholder jf-placeholder--featured c&lt;d"');
    expect(html).toContain('width="10" height="20"');
  });
});

describe("ctx.media", () => {
  it("resolves through the host resolver and cleans up on deactivate", async () => {
    const app = new App(CONFIG);
    const loader = new PluginLoader(app, {
      placeholderResolver: (siteId, kind) =>
        siteId === "off"
          ? null
          : { kind, src: `/placeholders/${kind}.svg`, width: 1, height: 1, source: "core" },
    });
    let shop: PluginContext | undefined;
    loader.register(
      plugin("justflows.shop", (ctx) => {
        shop = ctx;
        ctx.media.registerPlaceholder("justflows.shop.product", PRODUCT);
      }),
    );
    await loader.activate("justflows.shop", "site-1");

    expect(shop!.media.placeholder("thumbnail")?.src).toBe("/placeholders/thumbnail.svg");
    expect(shop!.media.placeholderHtml("thumbnail", { className: "x" })).toContain(
      'class="jf-placeholder jf-placeholder--thumbnail x"',
    );
    expect(loader.placeholderRegistry.get("justflows.shop.product")).toBeDefined();

    await loader.deactivate("justflows.shop", "site-1");
    expect(loader.placeholderRegistry.get("justflows.shop.product")).toBeUndefined();
  });

  it("returns nothing when the site switched placeholders off", async () => {
    const app = new App(CONFIG);
    const loader = new PluginLoader(app, { placeholderResolver: () => null });
    let ctx: PluginContext | undefined;
    loader.register(plugin("justflows.shop", (c) => void (ctx = c)));
    await loader.activate("justflows.shop", "site-1");
    expect(ctx!.media.placeholder("featured")).toBeNull();
    expect(ctx!.media.placeholderHtml("featured")).toBe("");
  });

  it("falls back to the plugin registry without a host resolver", async () => {
    const app = new App(CONFIG);
    const loader = new PluginLoader(app);
    let ctx: PluginContext | undefined;
    loader.register(
      plugin("justflows.shop", (c) => {
        ctx = c;
        c.media.registerPlaceholder("justflows.shop.product", PRODUCT);
      }),
    );
    await loader.activate("justflows.shop", "site-1");
    expect(ctx!.media.placeholder("justflows.shop.product")).toMatchObject({
      src: PRODUCT.src,
      source: "plugin",
    });
    expect(ctx!.media.placeholder("featured")).toBeNull();
  });
});
