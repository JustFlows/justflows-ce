import { describe, expect, it } from "vitest";
import { resolveReusableBlocks, type ReusableBlock } from "../reusable-blocks.js";
import type { BlockNode } from "../types.js";

function node(id: string, type: string, children?: BlockNode[]): BlockNode {
  return { id, type, version: 1, props: {}, ...(children ? { children } : {}) };
}

function ref(id: string, target: string): BlockNode {
  return { id, type: "core.reusable", version: 1, props: { ref: target } };
}

function library(...entries: Array<[string, BlockNode[]]>): Map<string, ReusableBlock> {
  return new Map(
    entries.map(([id, blocks]) => [id, { id, name: id, blocks, updatedAt: "" } as ReusableBlock]),
  );
}

describe("resolveReusableBlocks", () => {
  it("swaps a reference for the blocks it points at", () => {
    const out = resolveReusableBlocks(
      [node("1", "core.heading"), ref("2", "saved")],
      library(["saved", [node("s1", "core.paragraph"), node("s2", "core.button")]]),
    );
    expect(out.map((b) => b.type)).toEqual(["core.heading", "core.paragraph", "core.button"]);
  });

  it("resolves references nested inside a container", () => {
    const out = resolveReusableBlocks(
      [node("1", "core.section", [ref("2", "saved")])],
      library(["saved", [node("s1", "core.paragraph")]]),
    );
    expect(out[0]?.children?.map((b) => b.type)).toEqual(["core.paragraph"]);
  });

  it("drops a reference whose target is gone rather than rendering a placeholder", () => {
    const out = resolveReusableBlocks([node("1", "core.heading"), ref("2", "missing")], library());
    expect(out.map((b) => b.type)).toEqual(["core.heading"]);
  });

  it("ignores a reference with no target", () => {
    const orphan: BlockNode = { id: "x", type: "core.reusable", version: 1, props: {} };
    expect(resolveReusableBlocks([orphan], library())).toEqual([]);
  });

  it("stops a saved block that references itself from spinning", () => {
    const lib = library(["loop", [ref("inner", "loop")]]);
    expect(() => resolveReusableBlocks([ref("1", "loop")], lib)).not.toThrow();
    expect(resolveReusableBlocks([ref("1", "loop")], lib)).toEqual([]);
  });

  it("stops two saved blocks that reference each other", () => {
    const lib = library(["a", [ref("ia", "b")]], ["b", [ref("ib", "a")]]);
    expect(resolveReusableBlocks([ref("1", "a")], lib)).toEqual([]);
  });

  it("leaves a document without references untouched", () => {
    const blocks = [node("1", "core.heading"), node("2", "core.section", [node("3", "core.paragraph")])];
    expect(resolveReusableBlocks(blocks, library())).toEqual(blocks);
  });

  it("rejects a reference id that is not a plain identifier", () => {
    const nasty: BlockNode = { id: "x", type: "core.reusable", version: 1, props: { ref: "../../etc" } };
    expect(resolveReusableBlocks([nasty], library(["../../etc", [node("s", "core.paragraph")]]))).toEqual([]);
  });
});
