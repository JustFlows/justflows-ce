import { describe, expect, it } from "vitest";
import { withBlockChrome } from "./block-chrome.js";
import { createBlockRegistrySync } from "./index.js";

describe("withBlockChrome", () => {
  it("adds editor classes to the block's own root element", () => {
    const out = withBlockChrome('<section class="jf-hero">Hi</section>', {
      id: "abc",
      props: { className: "featured wide" },
    });
    expect(out).toBe('<section class="jf-hero featured wide">Hi</section>');
  });

  it("emits scoped CSS and the class that ties it to the block", () => {
    const out = withBlockChrome("<section>Hi</section>", {
      id: "abc",
      props: { css: "padding: 2rem" },
    });
    expect(out).toContain("<style>.jf-b-abc {padding: 2rem}</style>");
    expect(out).toContain('<section class="jf-b-abc">');
  });

  it("keeps the style element outside the element it styles", () => {
    const out = withBlockChrome("<section>Hi</section>", { id: "abc", props: { css: "color: red" } });
    expect(out.indexOf("<style>")).toBeLessThan(out.indexOf("<section"));
  });

  it("does not touch a block with nothing attached", () => {
    expect(withBlockChrome("<p>Hi</p>", { id: "abc", props: {} })).toBe("<p>Hi</p>");
  });

  it("still applies animation", () => {
    const out = withBlockChrome("<section>Hi</section>", {
      id: "abc",
      props: { animation: { entrance: "fade" }, className: "featured" },
    });
    expect(out).toContain("jf-anim-e-fade");
    expect(out).toContain("featured");
  });

  it("skips CSS for a block that has no id to scope it to", () => {
    const out = withBlockChrome("<section>Hi</section>", { props: { css: "color: red" } });
    expect(out).toBe("<section>Hi</section>");
  });

  it("drops CSS that was somehow stored despite the save-time check", () => {
    const out = withBlockChrome("<section>Hi</section>", {
      id: "abc",
      props: { css: "@import url(//attacker.example/x);" },
    });
    expect(out).toBe("<section>Hi</section>");
  });

  it("wraps a fragment that has no single root element", () => {
    const out = withBlockChrome("one<br>two", { id: "abc", props: { className: "featured" } });
    expect(out).toBe('<div class="featured">one<br>two</div>');
  });
});

describe("block rendering", () => {
  const registry = createBlockRegistrySync();

  it("carries per-block CSS through renderNode for any block type", () => {
    const html = registry.renderNode({
      id: "abc",
      type: "core.paragraph",
      props: { text: "Hello", css: "& { color: red }", className: "lead" },
    });
    expect(html).toContain(".jf-b-abc { color: red }");
    expect(html).toContain("jf-b-abc");
    expect(html).toContain("lead");
  });
});

describe("grid placement", () => {
  it("puts placement on the block's own root, where a grid item reads it", () => {
    const out = withBlockChrome("<section>Hi</section>", {
      id: "abc",
      props: { layout: { col: 4, span: 6 } },
    });
    expect(out).toBe('<section style="--jf-col:4;--jf-span:6;--jf-span-t:6">Hi</section>');
  });

  it("emits nothing for a block that is simply full width", () => {
    expect(withBlockChrome("<section>Hi</section>", { id: "abc", props: { layout: { col: 1, span: 12 } } }))
      .toBe("<section>Hi</section>");
  });

  it("merges placement with a style the block already had", () => {
    const out = withBlockChrome('<section style="color:red">Hi</section>', {
      id: "abc",
      props: { layout: { col: 2, span: 4 } },
    });
    expect(out).toContain("color:red;--jf-col:2");
  });

  it("combines with animation and editor classes on one element", () => {
    const out = withBlockChrome("<section>Hi</section>", {
      id: "abc",
      props: { layout: { col: 3, span: 4 }, className: "lead", animation: { entrance: "fade" } },
    });
    expect(out).toContain("--jf-anim-duration");
    expect(out).toContain("--jf-col:3");
    expect(out).toContain("lead");
    expect(out).toContain("jf-anim-e-fade");
  });
});
