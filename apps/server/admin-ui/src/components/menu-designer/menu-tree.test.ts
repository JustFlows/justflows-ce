import { describe, expect, it } from "vitest";
import {
  duplicateItem,
  extractItem,
  findItemPath,
  flattenItems,
  indentItem,
  insertItem,
  maxTreeDepth,
  moveItem,
  moveItemTo,
  outdentItem,
  removeItem,
  updateItem,
  type MenuItem,
} from "./menu-tree";

const item = (id: string, children?: MenuItem[]): MenuItem => ({
  id,
  label: id,
  type: "custom",
  url: "#",
  ...(children ? { children } : {}),
});

describe("findItemPath / removeItem / insertItem", () => {
  it("finds nested items by id", () => {
    const tree = [item("a", [item("a1"), item("a2")]), item("b")];
    expect(findItemPath(tree, "a2")).toEqual([0, 1]);
    expect(findItemPath(tree, "b")).toEqual([1]);
    expect(findItemPath(tree, "missing")).toBeNull();
  });

  it("removes a root item and a nested item", () => {
    const tree = [item("a", [item("a1")]), item("b")];
    expect(removeItem(tree, "b").map((i) => i.id)).toEqual(["a"]);
    expect(removeItem(tree, "a1")[0]?.children).toEqual([]);
  });

  it("inserts at the top level and under a parent", () => {
    const tree = [item("a")];
    expect(insertItem(tree, null, 1, item("b")).map((i) => i.id)).toEqual(["a", "b"]);
    expect(insertItem(tree, "a", 0, item("a1"))[0]?.children?.map((i) => i.id)).toEqual(["a1"]);
  });
});

describe("extractItem", () => {
  it("removes and returns a node, movable into another tree", () => {
    const tree = [item("a")];
    const extracted = extractItem(tree, "a");
    expect(extracted?.node.id).toBe("a");
    expect(extracted?.items).toEqual([]);
    expect(insertItem([], null, 0, extracted!.node).map((i) => i.id)).toEqual(["a"]);
  });
});

describe("updateItem", () => {
  it("updates a nested item without disturbing siblings", () => {
    const tree = [item("a", [item("a1")]), item("b")];
    const next = updateItem(tree, "a1", (i) => ({ ...i, label: "renamed" }));
    expect(next[0]?.children?.[0]?.label).toBe("renamed");
    expect(next[1]?.id).toBe("b");
  });
});

describe("moveItem (same-level reorder)", () => {
  it("swaps with the previous/next sibling and no-ops at the edges", () => {
    const tree = [item("a"), item("b"), item("c")];
    expect(moveItem(tree, "a", 1).map((i) => i.id)).toEqual(["b", "a", "c"]);
    expect(moveItem(tree, "a", -1).map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(moveItem(tree, "c", 1).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});

describe("moveItemTo", () => {
  it("reparents an item into another branch", () => {
    const tree = [item("a", [item("a1")]), item("b")];
    const next = moveItemTo(tree, "b", "a", 1);
    expect(next).toHaveLength(1);
    expect(next[0]?.children?.map((i) => i.id)).toEqual(["a1", "b"]);
  });

  it("refuses to move an item into its own descendant", () => {
    const tree = [item("a", [item("a1")])];
    const next = moveItemTo(tree, "a", "a1", 0);
    expect(next).toEqual(tree);
  });
});

describe("indentItem / outdentItem", () => {
  it("indents an item under its previous sibling", () => {
    const tree = [item("a"), item("b")];
    const next = indentItem(tree, "b");
    expect(next).toHaveLength(1);
    expect(next[0]?.children?.map((i) => i.id)).toEqual(["b"]);
  });

  it("is a no-op for the first item at a level", () => {
    const tree = [item("a"), item("b")];
    expect(indentItem(tree, "a")).toEqual(tree);
  });

  it("outdents a child to become its parent's next sibling", () => {
    const tree = [item("a", [item("a1"), item("a2")])];
    const next = outdentItem(tree, "a1");
    expect(next.map((i) => i.id)).toEqual(["a", "a1"]);
    expect(next[0]?.children?.map((i) => i.id)).toEqual(["a2"]);
  });

  it("is a no-op for a top-level item", () => {
    const tree = [item("a"), item("b")];
    expect(outdentItem(tree, "a")).toEqual(tree);
  });
});

describe("duplicateItem", () => {
  it("clones an item and its subtree with fresh ids, inserted right after it", () => {
    const tree = [item("a", [item("a1")])];
    const { items: next, newId } = duplicateItem(tree, "a");
    expect(next).toHaveLength(2);
    expect(newId).not.toBe("a");
    expect(next[1]?.id).toBe(newId);
    expect(next[1]?.children?.[0]?.id).not.toBe("a1");
    expect(next[1]?.children?.[0]?.label).toBe("a1");
  });
});

describe("maxTreeDepth", () => {
  it("counts the deepest branch, root items as depth 1", () => {
    expect(maxTreeDepth([item("a")])).toBe(1);
    expect(maxTreeDepth([item("a", [item("a1")])])).toBe(2);
    expect(maxTreeDepth([item("a", [item("a1", [item("a1a")])])])).toBe(3);
  });
});

describe("flattenItems", () => {
  it("flattens depth-first with depth and path", () => {
    const tree = [item("a", [item("a1")]), item("b")];
    expect(flattenItems(tree)).toEqual([
      { item: tree[0], depth: 0, path: [0] },
      { item: tree[0]!.children![0], depth: 1, path: [0, 0] },
      { item: tree[1], depth: 0, path: [1] },
    ]);
  });
});
