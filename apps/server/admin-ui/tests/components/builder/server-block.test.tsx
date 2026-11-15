// SPDX-License-Identifier: MIT
import { render } from "@testing-library/react";
import { createBlockRegistrySync } from "@justflows/blocks";
import { describe, expect, it, vi } from "vitest";
import { BlockPreview } from "../../../src/components/builder/BlockPreview";
import { SERVER_RENDERED_TYPES } from "../../../src/components/builder/ServerBlock";
import type { BlockNode } from "../../../src/components/builder/types";

/**
 * Core blocks drawn by the public renderer on the canvas (justflows-ce#311):
 * the block's own HTML, with child blocks still drawn by the canvas so they
 * stay selectable and editable.
 */

vi.mock("../../../src/i18n/I18nProvider", () => ({ useT: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../../../src/lib/theme-style-tokens", () => ({ useThemeStyleTokens: () => ({ theme: "", tokens: [], blockControls: {} }) }));

const registry = createBlockRegistrySync();

function draw(block: BlockNode) {
  const renderChildren = (children: BlockNode[], depth: number) =>
    children.map((child) => <BlockPreview key={child.id} block={child} depth={depth} renderChildren={renderChildren} />);
  return render(<BlockPreview block={block} renderChildren={renderChildren} />);
}

const child: BlockNode = { id: "kid", type: "core.paragraph", version: 1, props: { text: "Inside" } };

describe("server-rendered core blocks", () => {
  it("covers the blocks moved so far", () => {
    expect([...SERVER_RENDERED_TYPES].sort()).toEqual(([
      "core.accordion", "core.button", "core.buttons", "core.callout", "core.card", "core.code", "core.cta", "core.column", "core.columns", "core.container", "core.cover",
      "core.details", "core.divider", "core.features", "core.grid", "core.group", "core.heading", "core.hero", "core.html", "core.icon", "core.link-list", "core.list", "core.list-item",
      "core.media-text", "core.paragraph", "core.quote", "core.section", "core.social-links", "core.spacer", "core.tab", "core.table", "core.tabs",
    ] as string[]).sort());
  });

  it("shows a hint for an empty Code, Custom HTML or Link list block, and the block once it has content", () => {
    const view = draw({ id: "k1", type: "core.code", version: 1, props: { code: "" } });
    expect(view.container.textContent).toContain("// code");
    expect(view.container.querySelector('[data-jf-server-block="core.code"]')).toBeNull();
    const renderChildren = (children: BlockNode[], depth: number) =>
      children.map((c) => <BlockPreview key={c.id} block={c} depth={depth} renderChildren={renderChildren} />);
    view.rerender(<BlockPreview block={{ id: "k1", type: "core.code", version: 1, props: { code: "let a = 1;", language: "js" } }} renderChildren={renderChildren} />);
    expect(view.container.querySelector('[data-jf-server-block="core.code"] pre code')?.textContent).toBe("let a = 1;");
    expect(draw({ id: "h1", type: "core.html", version: 1, props: { html: "<script>x</script>" } }).container.textContent).toContain("builder.preview.html");
    expect(draw({ id: "l1", type: "core.link-list", version: 1, props: { items: [] } }).container.textContent).toContain("builder.preview.noLinksYet");
  });

  it("keeps Custom HTML sanitized, as on the page", () => {
    const { container } = draw({ id: "h2", type: "core.html", version: 1, props: { html: '<p onclick="x()">Hi</p><img src=x onerror="alert(1)"><script>alert(2)</script>' } });
    const html = container.querySelector('[data-jf-server-block="core.html"]')!.innerHTML;
    expect(html).toContain("Hi");
    expect(html).not.toMatch(/onclick|onerror|<script/);
  });

  it("draws the public HTML of a block without children", () => {
    const { container } = draw({ id: "d1", type: "core.divider", version: 1, props: {} });
    const root = container.querySelector('[data-jf-server-block="core.divider"]')!;
    /** The block's own render, without the page's per-block wrapper, which the canvas draws itself. */
    expect(root.innerHTML).toBe('<hr data-jf-block-preview="d1">');
    expect(registry.renderNode({ type: "core.divider", props: {} })).toContain("<hr");
    expect(container.querySelector('[data-jf-server-block="core.spacer"]')).toBeNull();
  });

  it("puts the block's style and preset on its own root, as the page does", () => {
    const { container } = draw({ id: "g1", type: "core.section", version: 1, props: { style: { padTop: "6" }, styleRef: "card" }, children: [child] });
    const root = container.querySelector('[data-jf-server-block="core.section"] > section.jf-section') as HTMLElement;
    expect(root.getAttribute("data-jf-block-preview")).toBe("g1");
    expect(root.classList.contains("jf-sp-card")).toBe(true);
    expect(root.style.paddingTop).not.toBe("");
    expect(root.querySelector('.jf-section__inner [data-jf-block-preview="kid"]')).not.toBeNull();
  });

  it("keeps child blocks as canvas blocks inside the parent's own markup", () => {
    const { container } = draw({ id: "c1", type: "core.callout", version: 1, props: { title: "Note", variant: "warning" }, children: [child] });
    const content = container.querySelector(".jf-callout.jf-callout--warning .jf-callout-content")!;
    expect(content.querySelector(".jf-callout-title")?.textContent).toBe("Note");
    expect(content.querySelector('[data-jf-children-slot] [data-jf-block-preview="kid"]')).not.toBeNull();
    expect(content.textContent).toContain("Inside");
  });

  it("does not remount children when the parent's settings change", () => {
    const block: BlockNode = { id: "c1", type: "core.callout", version: 1, props: { title: "One" }, children: [child] };
    const view = draw(block);
    const before = view.container.querySelector('[data-jf-block-preview="kid"]');
    const renderChildren = (children: BlockNode[], depth: number) =>
      children.map((c) => <BlockPreview key={c.id} block={c} depth={depth} renderChildren={renderChildren} />);
    view.rerender(<BlockPreview block={{ ...block, props: { title: "Two", variant: "error" } }} renderChildren={renderChildren} />);
    expect(view.container.querySelector(".jf-callout--error .jf-callout-title")?.textContent).toBe("Two");
    expect(view.container.querySelector('[data-jf-block-preview="kid"]')).toBe(before);
  });

  it("keeps a Details block open so its content can be edited", () => {
    const { container } = draw({ id: "x1", type: "core.details", version: 1, props: { summary: "More", open: false }, children: [child] });
    const details = container.querySelector("details.jf-details") as HTMLDetailsElement;
    expect(details.open).toBe(true);
    expect(details.querySelector('[data-jf-block-preview="kid"]')).not.toBeNull();
  });

  it("does not autoplay a cover's background video", () => {
    const { container } = draw({ id: "v1", type: "core.cover", version: 1, props: { mediaType: "video", src: "/uploads/clip.mp4" }, children: [child] });
    const video = container.querySelector("video.jf-cover-media")!;
    expect(video.hasAttribute("autoplay")).toBe(false);
    expect(container.querySelector(".jf-cover-content [data-jf-block-preview='kid']")).not.toBeNull();
  });

  it("marks a Spacer so the builder can show its height", () => {
    const { container } = draw({ id: "s1", type: "core.spacer", version: 1, props: { height: 64 } });
    const root = container.querySelector('[data-jf-server-block="core.spacer"]')!;
    expect((root.firstElementChild as HTMLElement).style.height).toBe("64px");
  });
});

describe("checklists on the canvas", () => {
  it("reach their items through the canvas wrappers, but not a plain list nested inside", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    /** The suite runs from apps/server or from admin-ui. */
    const file = ["admin-ui/src/styles/builder.css", "src/styles/builder.css"].map((p) => path.resolve(process.cwd(), p)).find((p) => fs.existsSync(p))!;
    const css = fs.readFileSync(file, "utf8");
    const rule = css.match(/(\.jf-list--checklist > \[data-jf-children-slot\] \.jf-list-item:not\([^)]*\)[^)]*\)) \{/)![1]!;
    const item = (id: string, children: BlockNode[] = []): BlockNode => ({ id, type: "core.list-item", version: 1, props: { text: id }, children });
    const nested: BlockNode = { id: "inner", type: "core.list", version: 1, props: { listStyle: "bullet" }, children: [item("deep")] };
    const { container } = draw({ id: "cl", type: "core.list", version: 1, props: { listStyle: "checklist" }, children: [item("top", [nested])] });
    const li = (id: string) => container.querySelector(`[data-jf-block-preview="${id}"]`)!;
    expect(li("top").matches(rule)).toBe(true);
    expect(li("deep").matches(rule)).toBe(false);
  });
});

describe("in-place editing on server-rendered blocks", () => {
  const drawEditable = (block: BlockNode, onUpdate = vi.fn()) => {
    const view = render(<BlockPreview block={block} selectedId={block.id} onUpdateProps={onUpdate} />);
    return { ...view, onUpdate };
  };

  it("mounts an editor in each marked element, empty optional fields included", () => {
    const { container } = drawEditable({ id: "h", type: "core.hero", version: 1, props: { heading: "Big", subheading: "", buttonLabel: "" } });
    const editors = [...container.querySelectorAll('[contenteditable="true"]')];
    expect(editors.map((el) => el.parentElement?.getAttribute("data-jf-inline")).sort()).toEqual(["buttonLabel", "heading", "subheading"]);
    expect(container.querySelector(".jf-hero__heading [contenteditable]")?.textContent).toBe("Big");
  });

  it("does not redraw the markup under an open editor when another field commits", () => {
    const block: BlockNode = { id: "c", type: "core.cta", version: 1, props: { heading: "Join", text: "Now" } };
    const view = drawEditable(block);
    const textEditor = view.container.querySelector('.jf-cta__text [contenteditable="true"]');
    view.rerender(<BlockPreview block={{ ...block, props: { heading: "Join us", text: "Now" } }} selectedId="c" onUpdateProps={view.onUpdate} />);
    expect(view.container.querySelector('.jf-cta__text [contenteditable="true"]')).toBe(textEditor);
  });

  it("shows the page's markup with a placeholder for an empty required field when not selected", () => {
    const { container } = draw({ id: "e", type: "core.heading", version: 1, props: { text: "", level: 3 } });
    const heading = container.querySelector("h3[data-jf-inline='text']")!;
    expect(heading.textContent).toBe("builder.preview.heading");
    expect(container.querySelector("[contenteditable]")).toBeNull();
  });
});
