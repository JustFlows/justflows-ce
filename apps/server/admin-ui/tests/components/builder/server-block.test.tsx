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
  it("covers the first batch", () => {
    expect([...SERVER_RENDERED_TYPES].sort()).toEqual(["core.callout", "core.cover", "core.details", "core.divider", "core.media-text", "core.spacer"]);
  });

  it("draws the public HTML of a block without children", () => {
    const { container } = draw({ id: "d1", type: "core.divider", version: 1, props: {} });
    const root = container.querySelector('[data-jf-server-block="core.divider"]')!;
    /** The block's own render, without the page's per-block wrapper, which the canvas draws itself. */
    expect(root.innerHTML).toBe("<hr>");
    expect(registry.renderNode({ type: "core.divider", props: {} })).toContain("<hr");
    expect(container.querySelector('[data-jf-server-block="core.spacer"]')).toBeNull();
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
