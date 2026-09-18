import { describe, expect, it } from "vitest";
import { validateTemplateBlocks } from "../../../src/lib/rendering/template-validate.js";
import { registerTemplateBlocks } from "../../../src/lib/rendering/template-blocks.js";

registerTemplateBlocks();

describe("validateTemplateBlocks", () => {
  it("accepts a document of registered core + context blocks", () => {
    const result = validateTemplateBlocks([
      { id: "a", version: 1, type: "core.post-title", props: { level: 1 } },
      {
        id: "b", version: 1,
        type: "core.section",
        props: {},
        children: [{ id: "c", version: 1, type: "core.post-content", props: { wrap: "post" } }],
      },
    ]);
    expect(result).toEqual({ ok: true, unknownBlockTypes: [] });
  });

  it("reports unknown block types, recursing into children, de-duped and sorted", () => {
    const result = validateTemplateBlocks([
      { id: "a", version: 1, type: "acme.widget", props: {} },
      {
        id: "b", version: 1,
        type: "core.group",
        props: {},
        children: [
          { id: "c", version: 1, type: "acme.widget", props: {} },
          { id: "d", version: 1, type: "plugin.thing", props: {} },
        ],
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.unknownBlockTypes).toEqual(["acme.widget", "plugin.thing"]);
  });

  it("treats a non-array input as an empty document", () => {
    expect(validateTemplateBlocks(undefined as never)).toEqual({
      ok: true,
      unknownBlockTypes: [],
    });
  });
});
