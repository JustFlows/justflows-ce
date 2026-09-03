import { describe, expect, it } from "vitest";
import { PluginPatternRegistry } from "../pattern-registry.js";

const pattern = {
  id: "feature-grid",
  title: "Feature grid",
  category: "features",
  blocks: [{ id: "copy", type: "core.paragraph", version: 1, props: { text: "Hello" } }],
};

describe("PluginPatternRegistry", () => {
  it("validates, namespaces, and disposes registrations", () => {
    const registry = new PluginPatternRegistry();
    const dispose = registry.register("acme.designs", pattern);
    expect(registry.all()[0]).toMatchObject({
      id: "feature-grid",
      registryId: "acme.designs:feature-grid",
      pluginId: "acme.designs",
    });
    dispose();
    expect(registry.all()).toEqual([]);
  });

  it("rejects undeclared plugin blocks and duplicate ids", () => {
    expect(() =>
      new PluginPatternRegistry().register("acme.designs", {
        ...pattern,
        blocks: [{ ...pattern.blocks[0]!, type: "acme.cards.grid" }],
      }),
    ).toThrow(/requiresBlockTypes/);

    const registry = new PluginPatternRegistry();
    registry.register("acme.designs", pattern);
    expect(() => registry.register("acme.designs", pattern)).toThrow(/already registered/);
  });

  it("removes every contribution owned by a deactivated plugin", () => {
    const registry = new PluginPatternRegistry();
    registry.register("acme.one", pattern);
    registry.register("acme.two", pattern);
    registry.removePlugin("acme.one");
    expect(registry.all().map((item) => item.pluginId)).toEqual(["acme.two"]);
  });
});
