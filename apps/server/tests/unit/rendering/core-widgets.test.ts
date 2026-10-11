import { describe, expect, it, vi } from "vitest";
import {
  CONTENT_WIDGET,
  MENU_WIDGET,
  RECENT_POSTS_WIDGET,
  SEARCH_WIDGET,
  registerCoreWidgets,
  withCoreWidgetData,
  type CoreWidgetDataSource,
} from "../../../src/lib/rendering/core-widgets.js";
import { getRuntimeBlockRegistry } from "../../../src/lib/rendering/runtime-blocks.js";

registerCoreWidgets();
const registry = getRuntimeBlockRegistry();

function node(type: string, props: Record<string, unknown> = {}) {
  return { id: type, type, version: 1, props };
}

function render(block: ReturnType<typeof node>): string {
  return registry.renderNode(block);
}

function source(overrides: Partial<CoreWidgetDataSource> = {}): CoreWidgetDataSource {
  return {
    menu: async () => [{ label: "Home", url: "/", children: [{ label: "Team", url: "/team" }] }],
    recentPosts: async (limit) =>
      Array.from({ length: limit }, (_, i) => ({ title: `Post ${i}`, href: `/post-${i}`, date: "Oct 1" })),
    searchAction: () => "/nl/search",
    ...overrides,
  };
}

describe("core widgets", () => {
  it("are registered in the widgets category", () => {
    for (const type of [CONTENT_WIDGET, MENU_WIDGET, RECENT_POSTS_WIDGET, SEARCH_WIDGET]) {
      expect(registry.get(type)?.category).toBe("widgets");
    }
  });

  it("render content with a sanitized body", () => {
    const html = render(node(CONTENT_WIDGET, { title: "About", text: "<p>Hi</p><script>x</script>" }));
    expect(html).toContain('<h2 class="jf-widget__title">About</h2>');
    expect(html).toContain("<p>Hi</p>");
    expect(html).not.toContain("<script>");
  });

  it("attach menu, posts, and search data, then render it", async () => {
    const [menu, posts, search] = await withCoreWidgetData(
      [node(MENU_WIDGET, { menu: "footer", title: "Links" }), node(RECENT_POSTS_WIDGET, { count: 2 }), node(SEARCH_WIDGET)],
      source(),
    );
    expect(render(menu!)).toContain('<a href="/team">Team</a>');
    const postHtml = render(posts!);
    expect(postHtml.match(/<li>/g)).toHaveLength(2);
    expect(postHtml).toContain("Oct 1");
    expect(render(search!)).toContain('action="/nl/search"');
  });

  it("loads each menu once however many widgets use it", async () => {
    const menu = vi.fn(source().menu);
    await withCoreWidgetData([node(MENU_WIDGET, { menu: "a" }), node(MENU_WIDGET, { menu: "a" })], source({ menu }));
    expect(menu).toHaveBeenCalledTimes(1);
  });

  it("render nothing for a data widget without data, and neutralise unsafe links", async () => {
    expect(render(node(MENU_WIDGET, { menu: "footer" }))).toBe("");
    const [menu] = await withCoreWidgetData(
      [node(MENU_WIDGET, { menu: "x" })],
      source({ menu: async () => [{ label: "Bad", url: "javascript:alert(1)" }] }),
    );
    expect(render(menu!)).toContain('href="#"');
  });
});
