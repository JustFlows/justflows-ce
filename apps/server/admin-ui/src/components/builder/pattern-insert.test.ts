import { describe, expect, it } from "vitest";
import type { BlockNode } from "./types";
import { mergePatternBlocks, patternReplacesCanvas } from "./pattern-insert";

const current = [{ id: "existing" }] as BlockNode[];
const imported = [{ id: "imported" }] as BlockNode[];

describe("pattern insertion", () => {
  it("replaces the canvas only for whole-page patterns", () => {
    expect(patternReplacesCanvas("pages")).toBe(true);
    for (const category of [
      "hero",
      "features",
      "pricing",
      "testimonials",
      "faq",
      "calls-to-action",
      "site",
    ]) {
      expect(patternReplacesCanvas(category)).toBe(false);
    }
  });

  it("appends section patterns without discarding existing blocks", () => {
    expect(mergePatternBlocks(current, imported, false).map((block) => block.id)).toEqual([
      "existing",
      "imported",
    ]);
  });

  it("uses a page pattern as the complete canvas", () => {
    expect(mergePatternBlocks(current, imported, true)).toEqual(imported);
  });
});
