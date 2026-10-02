// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { createBlockRegistrySync } from "@justflows/blocks";
import { describeBlockCatalog, validateAgentBlockDocument } from "../../../src/lib/ai/agent-blocks.js";

const registry = createBlockRegistrySync();

describe("agent block validation", () => {
  it("accepts a valid document and gives every node an id", () => {
    const result = validateAgentBlockDocument(
      {
        version: 1,
        blocks: [
          { type: "core.heading", props: { text: "Hello", level: 2 } },
          {
            type: "core.columns",
            props: { columns: 2 },
            children: [
              { type: "core.column", children: [{ type: "core.paragraph", props: { text: "<p>Left</p>" } }] },
              { type: "core.column", children: [{ type: "core.paragraph", props: { text: "<p>Right</p>" } }] },
            ],
          },
        ],
      },
      registry,
    );
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    const [heading, columns] = result.document.blocks as { id: string; children?: { id: string }[] }[];
    expect(heading!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(columns!.children?.[0]?.id).toBeTruthy();
  });

  it("also accepts a bare array of blocks", () => {
    expect(validateAgentBlockDocument([{ type: "core.paragraph", props: { text: "x" } }], registry).ok).toBe(true);
  });

  it("rejects unknown block types and names the valid ones", () => {
    const result = validateAgentBlockDocument({ version: 1, blocks: [{ type: "core.carousel", props: {} }] }, registry);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/unknown block type "core.carousel"/);
    expect(result.errors[0]).toMatch(/Valid types: .*core\.paragraph/);
  });

  it("rejects missing required props and invalid select options", () => {
    const result = validateAgentBlockDocument(
      {
        version: 1,
        blocks: [
          { type: "core.heading", props: {} },
          { type: "core.button", props: { label: "Go", url: "/x", variant: "neon" } },
        ],
      },
      registry,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/blocks\[0\] \(core\.heading\): required prop "text" is missing/);
    expect(result.errors.join("\n")).toMatch(/blocks\[1\] \(core\.button\): prop "variant" must be one of/);
  });

  it("rejects children on blocks that cannot contain them", () => {
    const result = validateAgentBlockDocument(
      { version: 1, blocks: [{ type: "core.paragraph", props: { text: "x" }, children: [{ type: "core.divider" }] }] },
      registry,
    );
    expect(result.errors.join("\n")).toMatch(/cannot contain child blocks/);
  });

  it("rejects a non-document input with a usable message", () => {
    expect(validateAgentBlockDocument("hello", registry).errors[0]).toMatch(/"version": 1/);
  });

  it("describes the catalog with props, required flags and options", () => {
    const catalog = describeBlockCatalog(registry);
    const button = catalog.find((block) => block.type === "core.button");
    expect(button?.props.variant).toMatchObject({ type: "select", options: ["primary", "secondary", "outline"] });
    expect(button?.props.label).toMatchObject({ required: true });
  });
});
