import { describe, it, expect, vi, beforeEach } from "vitest";

type Filter = (value: unknown, filterCtx?: unknown, hookCtx?: unknown) => unknown;

function makeCtx(stored: Record<string, unknown> = {}) {
  const filters = new Map<string, Filter>();
  const settings = new Map(Object.entries(stored));
  const data = new Map<string, Map<string, unknown>>();
  return {
    filters,
    dataStore: data,
    ctx: {
      pluginId: "justflows.consent",
      hooks: {
        action: vi.fn(),
        filter: vi.fn((name: string, fn: Filter) => {
          filters.set(name, fn);
          return () => filters.delete(name);
        }),
      },
      http: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
      cookies: { declare: vi.fn(), list: vi.fn(async () => []) },
      settings: {
        get: vi.fn(async (key: string) => settings.get(key)),
        set: vi.fn(async (key: string, value: unknown) => void settings.set(key, value)),
        delete: vi.fn(async (key: string) => void settings.delete(key)),
      },
      data: {
        list: vi.fn(async (c: string) =>
          [...(data.get(c)?.entries() ?? [])].map(([id, d]) => ({ id, data: d })),
        ),
        get: vi.fn(async (c: string, id: string) => {
          const row = data.get(c)?.get(id);
          return row ? { id, data: row } : undefined;
        }),
        put: vi.fn(async (c: string, id: string, d: unknown) => {
          if (!data.has(c)) data.set(c, new Map());
          data.get(c)!.set(id, d);
        }),
        delete: vi.fn(async (c: string, id: string) => void data.get(c)?.delete(id)),
        clear: vi.fn(async () => void data.clear()),
      },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    },
  };
}

async function importPlugin() {
  return (await import("./index.js")).default;
}

describe("consent plugin", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("exports a valid manifest", async () => {
    const plugin = await importPlugin();
    expect(plugin.manifest.id).toBe("justflows.consent");
    expect(plugin.manifest.permissions).toContain("admin:extend");
    expect(plugin.manifest.adminMenu?.[0]?.path).toBe("/admin/consent");
    expect(plugin.manifest.adminMenu?.[0]?.domain).toBe("extensions");
    expect(plugin.manifest.registry).toEqual({
      commercialMarketplace: false,
      listed: true,
      free: true,
      comingSoon: false,
    });
  });

  it("registers the render-path hooks on activate", async () => {
    const plugin = await importPlugin();
    const { ctx, filters } = makeCtx();
    await plugin.activate(ctx as never);
    expect(filters.has("theme.css")).toBe(true);
    expect(filters.has("html.head")).toBe(true);
    expect(filters.has("analytics.head")).toBe(true);
    expect(filters.has("content.render")).toBe(true);
    expect(ctx.cookies.declare).toHaveBeenCalledWith(
      expect.objectContaining({ name: "jf_consent", category: "necessary" }),
    );
  });

  it("injects nothing while disabled and the runtime once enabled", async () => {
    const plugin = await importPlugin();
    const { ctx, filters } = makeCtx();
    await plugin.activate(ctx as never);

    const head = filters.get("html.head")!;
    expect(head("<title>x</title>")).toBe("<title>x</title>");

    await ctx.settings.set("config", { enabled: true });
    // re-activate to refresh the cached snapshot
    vi.resetModules();
    const plugin2 = await importPlugin();
    const two = makeCtx({ config: { enabled: true, analyticsSnippet: "gtag('x')" } });
    await plugin2.activate(two.ctx as never);
    const out = String(two.filters.get("html.head")!("<title>x</title>"));
    expect(out).toContain('id="jf-consent-config"');
    expect(out).toContain("/ext/justflows.consent/runtime.js");
    expect(out).toContain('data-jf-consent="analytics"');
  });

  it("analytics.head passes through when disabled and gates when enabled", async () => {
    const plugin = await importPlugin();
    const disabled = makeCtx();
    await plugin.activate(disabled.ctx as never);
    const tag = '<script async src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>';
    expect(disabled.filters.get("analytics.head")!(tag)).toBe(tag);

    vi.resetModules();
    const plugin2 = await importPlugin();
    const enabled = makeCtx({ config: { enabled: true } });
    await plugin2.activate(enabled.ctx as never);
    const out = String(enabled.filters.get("analytics.head")!(tag));
    expect(out).toContain('type="text/plain"');
    expect(out).toContain('data-jf-consent="analytics"');
  });

  it("content.render gates a foreign iframe only when gateEmbeds is on", async () => {
    vi.resetModules();
    const plugin = await importPlugin();
    const enabled = makeCtx({ config: { enabled: true, gateEmbeds: true } });
    await plugin.activate(enabled.ctx as never);
    const html = '<iframe src="https://player.vimeo.com/video/1"></iframe>';
    const out = String(await enabled.filters.get("content.render")!(html));
    expect(out).toContain("jf-consent-embed");
    expect(out).not.toContain("<iframe");
  });

  it("deleteData keeps records unless the operator opted in", async () => {
    const plugin = await importPlugin();
    const keep = makeCtx({ config: { enabled: true } });
    keep.dataStore.set("records", new Map([["c-1", { cid: "c-1" }]]));
    await plugin.deleteData(keep.ctx as never);
    expect(keep.ctx.data.clear).not.toHaveBeenCalled();

    const drop = makeCtx({ deleteDataOnUninstall: true });
    await plugin.deleteData(drop.ctx as never);
    expect(drop.ctx.data.clear).toHaveBeenCalled();
  });
});
