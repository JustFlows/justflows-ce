// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = new Map<string, unknown>();

vi.mock("../../../src/lib/settings/site-settings.js", () => ({
  getSiteId: async () => "site-1",
  getSiteSetting: async (_siteId: string, key: string) => stored.get(key) ?? null,
  setSiteSetting: async (_siteId: string, key: string, value: unknown) => {
    stored.set(key, value);
  },
}));

const { HooksRegistry } = await import("@justflows/core");
const hooks = new HooksRegistry();
const { PluginPlaceholderRegistry } = await import("@justflows/plugin-api");
const placeholderRegistry = new PluginPlaceholderRegistry();

vi.mock("../../../src/lib/plugins/plugin-runtime.js", () => ({
  getRuntimeHooks: () => hooks,
  getPluginLoader: () => ({ placeholderRegistry }),
}));

const {
  PLACEHOLDER_SETTINGS_KEY,
  getPlaceholderAdminState,
  invalidatePlaceholders,
  normalizePlaceholderSettings,
  renderPlaceholder,
  resolvePlaceholder,
  resolvePlaceholderSync,
  savePlaceholderSettings,
} = await import("../../../src/lib/media/placeholders.js");

const disposers: Array<() => void> = [];

beforeEach(() => {
  stored.clear();
  invalidatePlaceholders();
  placeholderRegistry.removePlugin("justflows.shop");
  while (disposers.length) disposers.pop()!();
});

describe("resolvePlaceholder", () => {
  it("returns the shipped image for a core kind", async () => {
    expect(await resolvePlaceholder("featured", "site-1")).toEqual({
      kind: "featured",
      src: "/placeholders/featured.svg",
      width: 1600,
      height: 900,
      source: "core",
    });
  });

  it("falls back to the generic image for an unknown kind", async () => {
    const image = await resolvePlaceholder("justflows.unknown.thing", "site-1");
    expect(image?.src).toBe("/placeholders/generic.svg");
    expect(image?.kind).toBe("justflows.unknown.thing");
  });

  it("uses a plugin-registered image for the plugin's kind", async () => {
    placeholderRegistry.register("justflows.shop", "justflows.shop.product", {
      src: "/ext/justflows.shop/product.svg",
      width: 800,
      height: 800,
    });
    expect(await resolvePlaceholder("justflows.shop.product", "site-1")).toMatchObject({
      src: "/ext/justflows.shop/product.svg",
      source: "plugin",
    });
  });

  it("prefers the site owner's image and skips filters", async () => {
    stored.set(PLACEHOLDER_SETTINGS_KEY, {
      enabled: true,
      images: { featured: { url: "/uploads/own.jpg", width: 1200, height: 675 } },
    });
    disposers.push(hooks.filter("media.placeholder", () => null));
    expect(await resolvePlaceholder("featured", "site-1")).toMatchObject({
      src: "/uploads/own.jpg",
      width: 1200,
      source: "site",
    });
  });

  it("returns null when the site switched placeholders off", async () => {
    stored.set(PLACEHOLDER_SETTINGS_KEY, { enabled: false, images: {} });
    expect(await resolvePlaceholder("featured", "site-1")).toBeNull();
    expect(await renderPlaceholder("featured", { siteId: "site-1" })).toBe("");
  });

  it("lets a filter replace or clear the default", async () => {
    disposers.push(
      hooks.filter("media.placeholder", (value: unknown, ctx: unknown) =>
        (ctx as { kind: string }).kind === "avatar"
          ? null
          : { ...(value as object), src: "https://cdn.example.com/p.png", width: 10 },
      ),
    );
    expect(await resolvePlaceholder("avatar", "site-1")).toBeNull();
    expect(await resolvePlaceholder("thumbnail", "site-1")).toMatchObject({
      src: "https://cdn.example.com/p.png",
      width: 10,
      height: 600,
      source: "filter",
    });
  });

  it("ignores an unsafe filter result", async () => {
    disposers.push(
      hooks.filter("media.placeholder", (value: unknown) => ({
        ...(value as object),
        src: "javascript:alert(1)",
      })),
    );
    expect((await resolvePlaceholder("generic", "site-1"))?.src).toBe("/placeholders/generic.svg");
  });

  it("serves defaults synchronously while the cache is cold", () => {
    stored.set(PLACEHOLDER_SETTINGS_KEY, { enabled: false, images: {} });
    expect(resolvePlaceholderSync("site-1", "generic")?.source).toBe("core");
  });
});

describe("renderPlaceholder", () => {
  it("renders a decorative, sized, escaped img", async () => {
    const html = await renderPlaceholder("featured", {
      siteId: "site-1",
      className: 'x" onload="y',
    });
    expect(html).toContain('src="/placeholders/featured.svg"');
    expect(html).toContain('alt=""');
    expect(html).toContain('width="1600" height="900"');
    expect(html).toContain("jf-placeholder jf-placeholder--featured");
    expect(html).not.toContain('onload="y');
  });
});

describe("placeholder settings", () => {
  it("drops stored images that are not uploads or https URLs", () => {
    expect(
      normalizePlaceholderSettings({
        images: {
          a: { url: "/uploads/a.png", width: 5, height: 5 },
          b: { url: "javascript:alert(1)" },
          c: { url: "http://insecure.example.com/c.png" },
        },
      }),
    ).toEqual({ enabled: true, images: { a: { url: "/uploads/a.png", width: 5, height: 5 } } });
  });

  it("saves an image with its media size and clears one with null", async () => {
    await savePlaceholderSettings(
      "site-1",
      { images: { featured: { url: "/uploads/f.jpg" } } },
      async () => ({ width: 1000, height: 500 }),
    );
    expect(await resolvePlaceholder("featured", "site-1")).toMatchObject({
      src: "/uploads/f.jpg",
      width: 1000,
    });
    await savePlaceholderSettings("site-1", { images: { featured: null } }, async () => null);
    expect((await resolvePlaceholder("featured", "site-1"))?.source).toBe("core");
  });

  it("rejects an image URL outside the media library", async () => {
    await expect(
      savePlaceholderSettings(
        "site-1",
        { images: { featured: { url: "/admin/evil" } } },
        async () => null,
      ),
    ).rejects.toThrow(/media library/);
  });

  it("lists core and plugin kinds for the admin page", async () => {
    placeholderRegistry.register("justflows.shop", "justflows.shop.product", {
      src: "/ext/justflows.shop/product.svg",
      width: 800,
      height: 800,
      label: "Product",
    });
    const state = await getPlaceholderAdminState("site-1");
    expect(state.enabled).toBe(true);
    expect(state.kinds.map((row) => row.kind)).toEqual([
      "generic",
      "featured",
      "thumbnail",
      "avatar",
      "og",
      "justflows.shop.product",
    ]);
    expect(state.kinds.at(-1)).toMatchObject({ owner: "justflows.shop", label: "Product" });
  });
});
