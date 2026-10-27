import { describe, expect, it } from "vitest";
import { inspectorSections } from "../../../src/components/builder/inspector-sections";
import type { BlockCatalogEntry, BlockNode } from "../../../src/components/builder/types";

function node(type: string, props: Record<string, unknown> = {}): BlockNode {
  return { id: "b1", type, version: 1, props };
}

function entry(type: string, inspector?: BlockCatalogEntry["inspector"]): BlockCatalogEntry {
  return { type, version: 1, title: type, category: "content", supportsChildren: false, inspector };
}

describe("inspectorSections", () => {
  it("follows the catalog entry", () => {
    const out = inspectorSections(node("acme.badge"), entry("acme.badge", { animation: false, colors: false }));
    expect(out.animation).toBe(false);
    expect(out.colors).toBe(false);
    expect(out.spacing).toBe(true);
    expect(out.themeVariables).toBe(false);
  });

  it("falls back to the core table without a catalog entry", () => {
    const out = inspectorSections(node("core.spacer"), undefined);
    expect(out.animation).toBe(false);
    expect(out.appearance).toBe(false);
  });

  it("keeps a switched-off section visible while the block stores a value for it", () => {
    const out = inspectorSections(
      node("core.spacer", {
        animation: { entrance: "fade" },
        style: { background: "#ff0000", radius: "lg", vars: { "--jf-hero-height": "50vh" } },
      }),
      undefined,
    );
    expect(out.animation).toBe(true);
    expect(out.colors).toBe(true);
    expect(out.appearance).toBe(true);
    expect(out.size).toBe(false);
    expect(out.themeVariables).toBe(false);
  });

  it("does not count a curated theme variable as using the full list", () => {
    const out = inspectorSections(
      node("core.hero", { style: { vars: { "--jf-hero-height": "50vh" } } }),
      undefined,
      new Set(["--jf-hero-height"]),
    );
    expect(out.themeVariables).toBe(false);
    const para = inspectorSections(
      node("core.paragraph", { style: { vars: { "--jf-hero-height": "50vh" } } }),
      undefined,
      new Set(["--jf-hero-height"]),
    );
    expect(para.themeVariables).toBe(false);
  });

  it("hides single fields but keeps them while they hold a value", () => {
    const card = inspectorSections(node("core.card"), undefined);
    expect(card.field("radius")).toBe(false);
    expect(card.field("marginTop")).toBe(true);
    expect(card.appearance).toBe(false);
    expect(card.spacing).toBe(true);
    const styled = inspectorSections(node("core.card", { style: { radius: "lg" } }), undefined);
    expect(styled.field("radius")).toBe(true);
    expect(styled.appearance).toBe(true);
  });

  it("drops a section whose fields are all hidden", () => {
    const out = inspectorSections(node("acme.x"), entry("acme.x", { hideFields: ["textAlign", "radius", "shadow"] }));
    expect(out.appearance).toBe(false);
  });

  it("offers caption alignment and colour only when the image has a caption", () => {
    const image = inspectorSections(node("core.image"), undefined);
    expect(image.field("textAlign")).toBe(false);
    expect(image.field("textColor")).toBe(false);
    const captioned = inspectorSections(node("core.image", { caption: "A lake" }), undefined);
    expect(captioned.field("textAlign")).toBe(true);
    expect(captioned.field("textColor")).toBe(true);
  });

  it("offers native accent colour for checklists, while preserving saved overrides", () => {
    expect(inspectorSections(node("core.list"), undefined).field("accent")).toBe(false);
    expect(inspectorSections(node("core.list", { listStyle: "checklist" }), undefined).field("accent")).toBe(true);
    expect(inspectorSections(node("core.list", { style: { accent: "red" } }), undefined).field("accent")).toBe(true);
  });

  it("keeps Advanced visible while the block has classes, CSS or device rules", () => {
    const supports = { advanced: false };
    expect(inspectorSections(node("acme.x", { className: "big" }), entry("acme.x", supports)).advanced).toBe(true);
    expect(inspectorSections(node("acme.x", { devices: ["mobile"] }), entry("acme.x", supports)).advanced).toBe(true);
    expect(inspectorSections(node("acme.x"), entry("acme.x", supports)).advanced).toBe(false);
  });

  it("does not offer generic style controls that overwrite a schema-owned style variant", () => {
    const catalog = { ...entry("core.color-scheme"), schema: { style: { type: "select" as const, default: "buttons", options: ["buttons", "switch"] } } };
    const out = inspectorSections(node("core.color-scheme", { style: "switch" }), catalog);
    expect(out.spacing).toBe(false);
    expect(out.size).toBe(false);
    expect(out.appearance).toBe(false);
    expect(out.colors).toBe(false);
    expect(out.animation).toBe(true);
    expect(out.advanced).toBe(true);
    const legacy = inspectorSections(node("core.color-scheme", { style: { background: "red" } }), catalog);
    expect(legacy.field("background")).toBe(true);
  });

});
