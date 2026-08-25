import { parseBlockPlacement } from "@justflows/blocks";
import { describe, expect, it } from "vitest";
import {
  columnAt,
  gridColumns,
  nextRow,
  placeAt,
  placementForDrop,
  resizeEnd,
  resizeStart,
  rowAt,
} from "./grid";
import type { BlockNode } from "./types";

const RECT = { left: 100, width: 1200 };
const full = parseBlockPlacement(undefined);

function child(layout?: Record<string, number>): BlockNode {
  return { id: crypto.randomUUID(), type: "core.paragraph", version: 1, props: layout ? { layout } : {} };
}

describe("columnAt", () => {
  it("maps a position to the track under it", () => {
    expect(columnAt(RECT, 12, 100)).toBe(1);
    expect(columnAt(RECT, 12, 199)).toBe(1);
    expect(columnAt(RECT, 12, 201)).toBe(2);
    expect(columnAt(RECT, 12, 1299)).toBe(12);
  });

  it("clamps a position outside the grid to the nearest edge", () => {
    expect(columnAt(RECT, 12, -500)).toBe(1);
    expect(columnAt(RECT, 12, 5000)).toBe(12);
  });

  it("survives a grid that has not been laid out yet", () => {
    expect(columnAt({ left: 0, width: 0 }, 12, 40)).toBe(1);
  });
});

describe("rowAt", () => {
  const sizes = [100, 50, 200];

  it("finds the row band containing the position", () => {
    expect(rowAt(sizes, 10, 0, 20)).toBe(1);
    expect(rowAt(sizes, 10, 0, 130)).toBe(2);
    expect(rowAt(sizes, 10, 0, 200)).toBe(3);
  });

  it("returns a new row past the last track", () => {
    expect(rowAt(sizes, 10, 0, 5000)).toBe(4);
  });

  it("treats an empty grid as its first row", () => {
    expect(rowAt([], 0, 0, 40)).toBe(1);
    expect(rowAt(sizes, 10, 0, -50)).toBe(1);
  });
});

describe("placeAt", () => {
  it("moves a block without changing its width", () => {
    const placed = placeAt(parseBlockPlacement({ col: 1, span: 4 }), { col: 7, row: 2 }, 12);
    expect(placed).toEqual({ col: 7, span: 4, row: 2, rowSpan: 1 });
  });

  it("pulls a block back inside rather than letting it spill", () => {
    expect(placeAt(parseBlockPlacement({ col: 1, span: 4 }), { col: 11, row: 1 }, 12).col).toBe(9);
  });
});

describe("resize", () => {
  it("drags the right edge, keeping the start column", () => {
    expect(resizeEnd(parseBlockPlacement({ col: 3, span: 2 }), 8, 12)).toMatchObject({ col: 3, span: 6 });
  });

  it("never resizes below one column or past the last", () => {
    expect(resizeEnd(parseBlockPlacement({ col: 3, span: 4 }), 1, 12).span).toBe(1);
    expect(resizeEnd(parseBlockPlacement({ col: 3, span: 4 }), 99, 12).span).toBe(10);
  });

  it("drags the left edge, keeping the right edge put", () => {
    expect(resizeStart(parseBlockPlacement({ col: 5, span: 4 }), 2, 12)).toMatchObject({ col: 2, span: 7 });
  });

  it("stops the left edge before it crosses the right one", () => {
    expect(resizeStart(parseBlockPlacement({ col: 5, span: 4 }), 11, 12)).toMatchObject({ col: 8, span: 1 });
  });
});

describe("placementForDrop", () => {
  it("arrives half width so a second drop sits beside it", () => {
    expect(placementForDrop({ col: 1, row: 1 }, 12)).toEqual({ col: 1, span: 6, row: 1, rowSpan: 1 });
    expect(placementForDrop({ col: 7, row: 1 }, 12)).toEqual({ col: 7, span: 6, row: 1, rowSpan: 1 });
  });

  it("takes only what is left when dropped near the edge", () => {
    expect(placementForDrop({ col: 10, row: 1 }, 12).span).toBe(3);
  });
});

describe("nextRow", () => {
  it("appends below everything already placed", () => {
    expect(nextRow([child({ col: 1, span: 6, row: 1 }), child({ col: 1, span: 6, row: 3 })], 12)).toBe(4);
  });

  it("counts a tall block's full height", () => {
    expect(nextRow([child({ col: 1, span: 6, row: 2, rowSpan: 3 })], 12)).toBe(5);
  });

  it("starts at the first row when nothing is pinned", () => {
    expect(nextRow([child(), child()], 12)).toBe(1);
  });
});

describe("gridColumns", () => {
  it("reads the grid's own column count", () => {
    expect(gridColumns({ id: "g", type: "core.grid", version: 1, props: { columns: 6 } })).toBe(6);
  });

  it("falls back and clamps rather than trusting stored junk", () => {
    expect(gridColumns({ id: "g", type: "core.grid", version: 1, props: {} })).toBe(12);
    expect(gridColumns({ id: "g", type: "core.grid", version: 1, props: { columns: 99 } })).toBe(12);
    expect(gridColumns({ id: "g", type: "core.grid", version: 1, props: { columns: 1 } })).toBe(2);
  });
});

describe("full-width default", () => {
  it("is what an unplaced block gets", () => {
    expect(full).toEqual({ col: 1, span: 12, row: 0, rowSpan: 1 });
  });
});
