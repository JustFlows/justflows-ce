import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (v: unknown, ctx: unknown) => unknown>();
let templateConfig: Record<string, unknown> | null = null;
const buildCalls: string[] = [];

vi.mock("../plugin-runtime.js", () => ({
  ensurePluginRuntime: async () => {},
  getRuntimeHooks: () => ({
    has: (hook: string) => handlers.has(hook),
    applyFilter: async (hook: string, value: unknown, ctx: unknown) => {
      const fn = handlers.get(hook);
      return fn ? fn(value, ctx) : value;
    },
  }),
}));

vi.mock("../header-templates.js", () => ({
  buildHeaderTemplate: async (_s: string, _l: string, _d: string, id: string) => {
    buildCalls.push(id);
    return templateConfig ? { ...BASE, ...templateConfig } : null;
  },
}));

let themeHeader: Record<string, unknown> | null = null;
vi.mock("../themes-db.js", () => ({
  getActiveTheme: async () => ({ theme_id: "justflows.sample", manifest: {} }),
  themeInstalledPath: () => null,
}));
vi.mock("../theme-files.js", () => ({
  loadThemeDemoHeader: () => themeHeader,
}));

const { resolveHeaderConfig } = await import("../header-resolve.js");
const { DEFAULT_PAGE_HEADER } = await import("../page-header.js");
const BASE = { ...DEFAULT_PAGE_HEADER, blocks: [] as unknown[] };

function libWith(entries: unknown[], defaultId: string | null) {
  return { version: 1 as const, defaultId, entries } as never;
}
const entry = (id: string, base: Record<string, unknown> = {}) => ({
  id,
  name: id,
  base: { ...BASE, ...base },
  overrides: {},
  updatedAt: "2026-01-01T00:00:00Z",
});

const common = { siteId: "s1", locale: "en-US", defaultLocale: "en-US" };

beforeEach(() => {
  handlers.clear();
  templateConfig = null;
  buildCalls.length = 0;
  themeHeader = null;
});

describe("resolveHeaderConfig precedence", () => {
  it("1. header.resolve wins over everything and is sanitised", async () => {
    handlers.set("header.resolve", () => ({ ...BASE, layout: "split", background: "url(x)" }));
    const cfg = await resolveHeaderConfig({
      ...common,
      library: libWith([entry("lib-1", { layout: "logo-center" })], "lib-1"),
      ref: "lib-1",
    });
    expect(cfg.layout).toBe("split");
    expect(cfg.background).toBe(""); // unsafe value dropped by parsePageHeader
    expect(buildCalls).toEqual([]);
  });

  it("2. a plugin template ref calls buildHeaderTemplate", async () => {
    templateConfig = { sticky: false };
    const cfg = await resolveHeaderConfig({
      ...common,
      library: libWith([], null),
      ref: "acme.shop:mega",
    });
    expect(buildCalls).toEqual(["acme.shop:mega"]);
    expect(cfg.sticky).toBe(false);
  });

  it("2b. falls through to the library when the template ref does not resolve", async () => {
    templateConfig = null; // buildHeaderTemplate returns null
    const cfg = await resolveHeaderConfig({
      ...common,
      library: libWith([entry("lib-1", { menuSlug: "primary" })], "lib-1"),
      ref: "acme.shop:ghost",
    });
    expect(cfg.menuSlug).toBe("primary");
  });

  it("3. library entry by ref, and __none__ hides the header", async () => {
    const library = libWith([entry("lib-1", { layout: "split" }), entry("lib-2")], "lib-2");
    expect((await resolveHeaderConfig({ ...common, library, ref: "lib-1" })).layout).toBe("split");
    expect((await resolveHeaderConfig({ ...common, library, ref: "__none__" })).visible).toBe(
      false,
    );
  });

  it("3b. no library default -> the active theme's demo/header.json, merged and sanitised", async () => {
    themeHeader = { layout: "split", showColorScheme: true, background: "url(evil)" };
    const cfg = await resolveHeaderConfig({
      ...common,
      library: libWith([], null),
      ref: "__default__",
    });
    expect(cfg.layout).toBe("split");
    expect(cfg.showColorScheme).toBe(true);
    expect(cfg.background).toBe(""); // unsafe value dropped by parsePageHeader
  });

  it("3c. no library default and no theme header -> built-in DEFAULT_PAGE_HEADER", async () => {
    themeHeader = null;
    const cfg = await resolveHeaderConfig({
      ...common,
      library: libWith([], null),
      ref: "__default__",
    });
    expect(cfg).toEqual({ ...DEFAULT_PAGE_HEADER, blocks: [] });
  });

  it("4. header.config adjusts whatever was resolved", async () => {
    handlers.set("header.config", (cfg) => ({ ...(cfg as object), showAuthLinks: true }));
    const cfg = await resolveHeaderConfig({
      ...common,
      library: libWith([entry("lib-1")], "lib-1"),
      ref: "__default__",
    });
    expect(cfg.showAuthLinks).toBe(true);
  });
});
