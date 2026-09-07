import { describe, expect, it } from "vitest";
import {
  detectRegionMode,
  emptyCustomRegion,
  emptyLinksRegion,
  emptyPromoRegion,
  linkListItems,
  promoContent,
  withLinkListItems,
  withPromoContent,
} from "./mega-region";
import type { MegaMenuRegion } from "./menu-tree";

describe("detectRegionMode", () => {
  it("treats a freshly added (empty) region as the common links case", () => {
    expect(detectRegionMode({ id: "r", blocks: [] })).toBe("links");
  });

  it("recognizes a sole link-list block as links mode", () => {
    const region = emptyLinksRegion();
    expect(detectRegionMode(region)).toBe("links");
  });

  it("recognizes a sole section block as promo mode", () => {
    const region = emptyPromoRegion();
    expect(detectRegionMode(region)).toBe("promo");
  });

  it("falls back to custom for anything else, so hand-built content is never hidden", () => {
    const region: MegaMenuRegion = {
      id: "r",
      blocks: [
        { id: "a", type: "core.paragraph", version: 1, props: { text: "x" } },
        { id: "b", type: "core.image", version: 1, props: { src: "y" } },
      ],
    };
    expect(detectRegionMode(region)).toBe("custom");
  });
});

describe("link list round-trip", () => {
  it("starts a new region with one empty row", () => {
    const region = emptyLinksRegion();
    expect(linkListItems(region)).toEqual([{ label: "", url: "" }]);
  });

  it("reads back what was written, preserving the underlying block id", () => {
    const region = emptyLinksRegion();
    const blockId = region.blocks[0]!.id;
    const next = withLinkListItems(region, [
      { label: "SSL/TLS", url: "/ssl" },
      { label: "Code signing", url: "/code-signing" },
    ]);
    expect(linkListItems(next)).toEqual([
      { label: "SSL/TLS", url: "/ssl" },
      { label: "Code signing", url: "/code-signing" },
    ]);
    expect(next.blocks[0]!.id).toBe(blockId);
    expect(next.blocks[0]!.type).toBe("core.link-list");
  });
});

describe("promo content round-trip", () => {
  it("starts a new promo region dark, with empty text", () => {
    const region = emptyPromoRegion();
    expect(promoContent(region)).toEqual({
      background: "dark",
      heading: "",
      body: "",
      buttonLabel: "",
      buttonUrl: "",
    });
  });

  it("reads back what was written, preserving the section id and nested block ids", () => {
    const region = emptyPromoRegion();
    const sectionId = region.blocks[0]!.id;
    const childIds = region.blocks[0]!.children!.map((c) => c.id);

    const next = withPromoContent(region, {
      background: "primary",
      heading: "Not sure which certificate?",
      body: "The wizard recommends one based on three questions.",
      buttonLabel: "Start the wizard",
      buttonUrl: "/wizard",
    });

    expect(promoContent(next)).toEqual({
      background: "primary",
      heading: "Not sure which certificate?",
      body: "The wizard recommends one based on three questions.",
      buttonLabel: "Start the wizard",
      buttonUrl: "/wizard",
    });
    expect(next.blocks[0]!.id).toBe(sectionId);
    expect(next.blocks[0]!.children!.map((c) => c.id)).toEqual(childIds);
  });

  it("falls back to the safe defaults for an unrecognized background value", () => {
    const region: MegaMenuRegion = {
      id: "r",
      blocks: [{ id: "s", type: "core.section", version: 1, props: { background: "not-a-real-value" }, children: [] }],
    };
    expect(promoContent(region).background).toBe("dark");
  });
});

describe("emptyCustomRegion", () => {
  it("starts blank, so detectRegionMode treats it as the links default until the author picks", () => {
    const region = emptyCustomRegion();
    expect(region.blocks).toEqual([]);
  });
});
