import { describe, expect, it } from "vitest";
import { formatBlockNodeJson, formatPageJson, parseBlockNodeJson, parsePageJson } from "./block-json";
import type { BlockNode } from "./types";

const base: BlockNode = {
  id: "block-1",
  type: "core.paragraph",
  version: 1,
  props: { text: "Hello" },
};

describe("formatBlockNodeJson", () => {
  it("shows the editable shape without the id handle", () => {
    expect(JSON.parse(formatBlockNodeJson(base))).toEqual({
      type: "core.paragraph",
      version: 1,
      props: { text: "Hello" },
    });
  });

  it("includes children only when there are some", () => {
    const parent: BlockNode = { ...base, type: "core.group", children: [base] };
    expect(JSON.parse(formatBlockNodeJson(parent)).children).toHaveLength(1);
    expect(JSON.parse(formatBlockNodeJson(base)).children).toBeUndefined();
  });
});

describe("parseBlockNodeJson", () => {
  it("replaces type and props", () => {
    const next = parseBlockNodeJson('{"type":"core.heading","props":{"text":"Hi","level":2}}', base);
    expect(next).toEqual({
      id: "block-1",
      type: "core.heading",
      version: 1,
      props: { text: "Hi", level: 2 },
    });
  });

  it("keeps the block's id whatever the JSON says", () => {
    const next = parseBlockNodeJson('{"type":"core.paragraph","id":"somewhere-else","props":{}}', base);
    expect(next.id).toBe("block-1");
  });

  it("gives every child an id", () => {
    const next = parseBlockNodeJson(
      '{"type":"core.group","props":{},"children":[{"type":"core.paragraph","props":{"text":"a"}}]}',
      base,
    );
    expect(next.children?.[0]?.id).toMatch(/./);
    expect(next.children?.[0]?.type).toBe("core.paragraph");
  });

  it("keeps a child id that is already set", () => {
    const next = parseBlockNodeJson(
      '{"type":"core.group","props":{},"children":[{"id":"kid","type":"core.paragraph","props":{}}]}',
      base,
    );
    expect(next.children?.[0]?.id).toBe("kid");
  });

  it("defaults an omitted props and version to the block's own", () => {
    const next = parseBlockNodeJson('{"type":"core.paragraph"}', base);
    expect(next.props).toEqual({});
    expect(next.version).toBe(1);
  });

  it("reports where the JSON is malformed", () => {
    expect(() => parseBlockNodeJson("{nope}", base)).toThrow();
  });

  it("rejects a document that is not a single block", () => {
    expect(() => parseBlockNodeJson("[]", base)).toThrow(/Expected an object/);
    expect(() => parseBlockNodeJson('{"props":{}}', base)).toThrow(/"type" is required/);
  });

  it("rejects props and children of the wrong shape", () => {
    expect(() => parseBlockNodeJson('{"type":"core.paragraph","props":[]}', base)).toThrow(/"props" must be an object/);
    expect(() => parseBlockNodeJson('{"type":"core.group","children":{}}', base)).toThrow(/"children" must be an array/);
    expect(() => parseBlockNodeJson('{"type":"core.group","children":[{"props":{}}]}', base)).toThrow(/child needs a "type"/);
  });
});

describe("formatPageJson", () => {
  it("shows the whole document", () => {
    expect(JSON.parse(formatPageJson([base]))).toEqual({
      version: 1,
      blocks: [{ id: "block-1", type: "core.paragraph", version: 1, props: { text: "Hello" } }],
    });
  });

  it("includes header chrome only when the builder edits one", () => {
    expect(JSON.parse(formatPageJson([base], { visible: true })).header).toEqual({ visible: true });
    expect(JSON.parse(formatPageJson([base])).header).toBeUndefined();
  });

  it("round-trips an empty page", () => {
    expect(parsePageJson(formatPageJson([])).blocks).toEqual([]);
  });
});

describe("parsePageJson", () => {
  it("keeps ids so scoped CSS and history stay pointed at the same blocks", () => {
    const next = parsePageJson('{"version":1,"blocks":[{"id":"keep-me","type":"core.paragraph","props":{}}]}');
    expect(next.blocks[0]?.id).toBe("keep-me");
  });

  it("gives a fresh id to a block pasted in without one", () => {
    const next = parsePageJson('{"blocks":[{"type":"core.paragraph","props":{}}]}');
    expect(next.blocks[0]?.id).toMatch(/./);
  });

  it("normalizes children too", () => {
    const next = parsePageJson(
      '{"blocks":[{"type":"core.group","props":{},"children":[{"type":"core.paragraph","props":{}}]}]}',
    );
    expect(next.blocks[0]?.children?.[0]?.id).toMatch(/./);
  });

  it("accepts a bare array of blocks", () => {
    expect(parsePageJson('[{"type":"core.paragraph","props":{}}]').blocks).toHaveLength(1);
  });

  it("passes header chrome through untouched for the caller to validate", () => {
    expect(parsePageJson('{"blocks":[],"header":{"visible":false}}').header).toEqual({ visible: false });
  });

  it("names the block that is wrong", () => {
    expect(() =>
      parsePageJson('{"blocks":[{"type":"core.paragraph"},{"props":{}}]}'),
    ).toThrow(/Block 2 needs a "type"/);
  });

  it("rejects anything that is not a document", () => {
    expect(() => parsePageJson('{"nope":1}')).toThrow(/Expected/);
    expect(() => parsePageJson("not json")).toThrow();
  });
});
