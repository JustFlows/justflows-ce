import { describe, expect, it } from "vitest";
import { extractBlock, insertBlock } from "./block-tree";
import type { BlockNode } from "./types";

const para = (id: string): BlockNode => ({
  id,
  type: "core.paragraph",
  version: 1,
  props: { text: id },
});

describe("extractBlock", () => {
  it("removes a root block and returns it", () => {
    const tree = [para("a"), para("b")];
    const result = extractBlock(tree, "a");
    expect(result?.node.id).toBe("a");
    expect(result?.blocks.map((b) => b.id)).toEqual(["b"]);
  });

  it("can move the extracted node into another tree", () => {
    const body = [para("hero")];
    const header: BlockNode[] = [];
    const extracted = extractBlock(body, "hero");
    expect(extracted).not.toBeNull();
    const nextHeader = insertBlock(header, null, 0, extracted!.node);
    expect(nextHeader.map((b) => b.id)).toEqual(["hero"]);
    expect(extracted!.blocks).toEqual([]);
  });
});
