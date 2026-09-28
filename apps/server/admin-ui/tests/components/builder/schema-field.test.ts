import { describe, expect, it } from "vitest";
import { schemaFieldVisible } from "../../../src/components/builder/BlockInspector";
import type { BlockSchemaField } from "../../../src/components/builder/types";

const schema: Record<string, BlockSchemaField> = {
  source: { type: "select", options: ["all", "products", "tags"], default: "all" },
  products: { type: "select", multiple: true, showWhen: { field: "source", equals: "products" } },
  limit: { type: "number", showWhen: { field: "source", equals: ["all", "products"] } },
};

describe("plugin block schema fields", () => {
  it("shows a field only while its showWhen matches, using the default when unset", () => {
    expect(schemaFieldVisible(schema.products!, {}, schema)).toBe(false);
    expect(schemaFieldVisible(schema.limit!, {}, schema)).toBe(true);
    expect(schemaFieldVisible(schema.products!, { source: "products" }, schema)).toBe(true);
    expect(schemaFieldVisible(schema.limit!, { source: "tags" }, schema)).toBe(false);
    expect(schemaFieldVisible(schema.source!, { source: "tags" }, schema)).toBe(true);
  });
});
