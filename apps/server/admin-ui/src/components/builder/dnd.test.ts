import { describe, expect, it } from "vitest";
import { canDropBlockType, getParentType, HEADER_SLOT_PARENT_TYPE, libraryTargetParent } from "./dnd";
import type { BlockCatalogEntry, BlockNode } from "./types";

function entry(
  type: string,
  extra: Partial<BlockCatalogEntry> = {},
): BlockCatalogEntry {
  return {
    type,
    version: 1,
    title: type,
    category: "layout",
    supportsChildren: false,
    ...extra,
  };
}

const catalog = new Map<string, BlockCatalogEntry>([
  ["core.section", entry("core.section", { supportsChildren: true })],
  ["core.columns", entry("core.columns", { supportsChildren: true, allowedChildTypes: ["core.column"] })],
  ["core.column", entry("core.column", { supportsChildren: true })],
  ["core.paragraph", entry("core.paragraph", { category: "content" })],
  ["core.heading", entry("core.heading", { category: "content" })],
]);

const tree: BlockNode[] = [
  {
    id: "section",
    type: "core.section",
    version: 1,
    props: {},
    children: [
      {
        id: "columns",
        type: "core.columns",
        version: 1,
        props: { columns: 2 },
        children: [
          { id: "col-a", type: "core.column", version: 1, props: {}, children: [] },
          { id: "col-b", type: "core.column", version: 1, props: {}, children: [] },
        ],
      },
    ],
  },
];

describe("canDropBlockType", () => {
  it("accepts content inside a column", () => {
    expect(canDropBlockType("core.column", "core.paragraph", catalog)).toBe(true);
    expect(canDropBlockType("core.column", "core.heading", catalog)).toBe(true);
  });

  it("rejects content dropped onto the columns wrapper", () => {
    expect(canDropBlockType("core.columns", "core.paragraph", catalog)).toBe(false);
    expect(canDropBlockType("core.columns", "core.column", catalog)).toBe(true);
  });

  it("keeps columns out of other parents", () => {
    expect(canDropBlockType("core.section", "core.column", catalog)).toBe(false);
    expect(canDropBlockType(null, "core.column", catalog)).toBe(false);
  });

  it("accepts any non-column block in the header slot", () => {
    expect(canDropBlockType(HEADER_SLOT_PARENT_TYPE, "core.paragraph", catalog)).toBe(true);
    expect(canDropBlockType(HEADER_SLOT_PARENT_TYPE, "core.heading", catalog)).toBe(true);
    expect(canDropBlockType(HEADER_SLOT_PARENT_TYPE, "core.section", catalog)).toBe(true);
    expect(canDropBlockType(HEADER_SLOT_PARENT_TYPE, "core.column", catalog)).toBe(false);
  });
});

describe("libraryTargetParent", () => {
  it("inserts into the selected container", () => {
    expect(libraryTargetParent(tree, "section", catalog)).toBe("section");
    expect(libraryTargetParent(tree, "col-b", catalog)).toBe("col-b");
  });

  it("routes a selected columns block into the first column", () => {
    expect(libraryTargetParent(tree, "columns", catalog)).toBe("col-a");
    expect(getParentType(tree, "col-a")).toBe("core.column");
  });
});
