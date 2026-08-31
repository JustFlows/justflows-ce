import { beforeEach, describe, expect, it, vi } from "vitest";

let templatesHandler: ((list: unknown[], ctx: unknown) => unknown) | null = null;

vi.mock("../plugin-runtime.js", () => ({
  ensurePluginRuntime: async () => {},
  getRuntimeHooks: () => ({
    has: (hook: string) => hook === "header.templates" && templatesHandler != null,
    applyFilter: async (hook: string, seed: unknown[], ctx: unknown) =>
      hook === "header.templates" && templatesHandler ? templatesHandler(seed, ctx) : seed,
  }),
}));

const { listHeaderTemplates, buildHeaderTemplate } = await import("../header-templates.js");

const SITE = "site-1";
beforeEach(() => {
  templatesHandler = null;
});

describe("listHeaderTemplates", () => {
  it("returns nothing when no plugin listens", async () => {
    expect(await listHeaderTemplates(SITE, "en-US", "en-US")).toEqual([]);
  });

  it("collects valid templates as metadata only (no build call)", async () => {
    const build = vi.fn();
    templatesHandler = (list) => [
      ...list,
      { id: "acme.shop:mega", name: "Mega menu", description: "Catalog-driven", build },
    ];
    const got = await listHeaderTemplates(SITE, "nl-NL", "en-US");
    expect(got).toEqual([
      { id: "acme.shop:mega", name: "Mega menu", source: "acme.shop", description: "Catalog-driven" },
    ]);
    expect(build).not.toHaveBeenCalled();
  });

  it("drops entries with a bad id, blank name, or missing build, and de-dupes", async () => {
    templatesHandler = (list) => [
      ...list,
      { id: "no-namespace", name: "x", build: () => ({}) },
      { id: "acme.a:one", name: "  ", build: () => ({}) },
      { id: "acme.a:two", name: "No build" },
      { id: "acme.a:ok", name: "Fine", build: () => ({}) },
      { id: "acme.a:ok", name: "Dupe", build: () => ({}) },
    ];
    const got = await listHeaderTemplates(SITE, "en-US", "en-US");
    expect(got.map((t) => t.id)).toEqual(["acme.a:ok"]);
  });
});

describe("buildHeaderTemplate", () => {
  it("runs build() and sanitises the result into a full header config", async () => {
    templatesHandler = (list) => [
      ...list,
      {
        id: "acme.a:hero",
        name: "Hero",
        build: (ctx: { locale: string }) => ({
          layout: "logo-center",
          background: "javascript:alert(1)", // unsafe -> dropped
          menuSlug: ctx.locale === "nl-NL" ? "nl-primary" : "primary",
          blocks: Array.from({ length: 60 }, () => ({ type: "core.paragraph" })), // capped at 40
        }),
      },
    ];
    const cfg = await buildHeaderTemplate(SITE, "nl-NL", "en-US", "acme.a:hero");
    expect(cfg).not.toBeNull();
    expect(cfg!.layout).toBe("logo-center");
    expect(cfg!.background).toBe("");
    expect(cfg!.menuSlug).toBe("nl-primary");
    expect(cfg!.blocks).toHaveLength(40);
    expect(cfg!.visible).toBe(true); // filled from defaults
  });

  it("returns null for an unknown id", async () => {
    templatesHandler = (list) => list;
    expect(await buildHeaderTemplate(SITE, "en-US", "en-US", "acme.a:ghost")).toBeNull();
  });

  it("returns null when build() throws", async () => {
    templatesHandler = (list) => [
      ...list,
      { id: "acme.a:boom", name: "Boom", build: () => { throw new Error("nope"); } },
    ];
    expect(await buildHeaderTemplate(SITE, "en-US", "en-US", "acme.a:boom")).toBeNull();
  });
});
