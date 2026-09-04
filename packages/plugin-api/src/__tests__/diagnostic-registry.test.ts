import { describe, expect, it } from "vitest";
import { PluginDiagnosticRegistry } from "../diagnostic-registry.js";

describe("PluginDiagnosticRegistry", () => {
  it("namespaces, runs, and removes plugin checks", async () => {
    const registry = new PluginDiagnosticRegistry();
    registry.register("acme.demo", {
      id: "provider",
      label: "Provider",
      run: () => ({ status: "ok", summary: "Ready" }),
    });
    expect(await registry.run()).toEqual([
      {
        pluginId: "acme.demo",
        id: "provider",
        label: "Provider",
        result: { status: "ok", summary: "Ready" },
      },
    ]);
    registry.removePlugin("acme.demo");
    expect(registry.list()).toEqual([]);
  });

  it("converts check failures into safe error results", async () => {
    const registry = new PluginDiagnosticRegistry();
    registry.register("acme.demo", {
      id: "broken",
      label: "Broken",
      run: () => {
        throw new Error("Unavailable");
      },
    });
    expect((await registry.run())[0]?.result).toEqual({ status: "error", summary: "Unavailable" });
  });
});
