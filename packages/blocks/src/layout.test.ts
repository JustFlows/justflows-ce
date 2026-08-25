import { describe, expect, it } from "vitest";
import {
  compactBlockPlacement,
  isDefaultPlacement,
  parseBlockPlacement,
  placementStyleVars,
  sanitizePlacementProp,
} from "./layout.js";

describe("parseBlockPlacement", () => {
  it("defaults to a full-width block", () => {
    expect(parseBlockPlacement(undefined)).toEqual({ col: 1, span: 12, row: 0, rowSpan: 1 });
  });

  it("keeps a valid placement", () => {
    expect(parseBlockPlacement({ col: 4, span: 6, row: 2, rowSpan: 3 })).toEqual({
      col: 4, span: 6, row: 2, rowSpan: 3,
    });
  });

  it("never lets a block spill past the last column", () => {
    // Spilling would add an implicit column and silently narrow every other row.
    expect(parseBlockPlacement({ col: 10, span: 6 }).span).toBe(3);
    expect(parseBlockPlacement({ col: 99, span: 4 }).col).toBe(12);
  });

  it("respects a narrower grid", () => {
    expect(parseBlockPlacement({ col: 5, span: 4 }, 6)).toEqual({ col: 5, span: 2, row: 0, rowSpan: 1 });
  });

  it("coerces junk instead of trusting it", () => {
    expect(parseBlockPlacement({ col: "3", span: "4.4", row: -8 })).toEqual({
      col: 3, span: 4, row: 0, rowSpan: 1,
    });
    expect(parseBlockPlacement("nonsense")).toEqual({ col: 1, span: 12, row: 0, rowSpan: 1 });
  });
});

describe("compactBlockPlacement", () => {
  it("stores nothing for a block that is simply full width", () => {
    expect(compactBlockPlacement(parseBlockPlacement(undefined))).toBeUndefined();
    expect(isDefaultPlacement(parseBlockPlacement(undefined))).toBe(true);
  });

  it("stores only what differs from the default", () => {
    expect(compactBlockPlacement(parseBlockPlacement({ col: 7, span: 6 }))).toEqual({ col: 7, span: 6 });
    expect(compactBlockPlacement(parseBlockPlacement({ col: 1, span: 6, row: 2, rowSpan: 2 }))).toEqual({
      col: 1, span: 6, row: 2, rowSpan: 2,
    });
  });

  it("round-trips through the sanitizer", () => {
    expect(sanitizePlacementProp({ col: 4, span: 5 })).toEqual({ col: 4, span: 5 });
    expect(sanitizePlacementProp({ col: 1, span: 12 })).toBeUndefined();
    expect(sanitizePlacementProp(null)).toBeUndefined();
  });
});

describe("placementStyleVars", () => {
  it("emits the properties the grid CSS reads", () => {
    expect(placementStyleVars(parseBlockPlacement({ col: 4, span: 6 }))).toBe(
      "--jf-col:4;--jf-span:6;--jf-span-t:6",
    );
  });

  it("widens a narrow block for tablet rather than leaving a sliver", () => {
    expect(placementStyleVars(parseBlockPlacement({ col: 1, span: 3 }))).toContain("--jf-span-t:6");
  });

  it("leaves a wide block alone on tablet", () => {
    expect(placementStyleVars(parseBlockPlacement({ col: 1, span: 8 }))).toContain("--jf-span-t:8");
  });

  it("emits row properties only when they are set", () => {
    expect(placementStyleVars(parseBlockPlacement({ col: 1, span: 6 }))).not.toContain("--jf-row");
    expect(placementStyleVars(parseBlockPlacement({ col: 1, span: 6, row: 3, rowSpan: 2 }))).toBe(
      "--jf-col:1;--jf-span:6;--jf-span-t:6;--jf-row:3;--jf-row-span:2",
    );
  });
});
