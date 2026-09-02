import { describe, expect, it } from "vitest";
import { PluginCapabilityRegistry } from "../capability-registry.js";

describe("PluginCapabilityRegistry", () => {
  it("registers capabilities and removes them with their plugin", () => {
    const registry = new PluginCapabilityRegistry();
    registry.register("acme.shop", { id: "orders:refund", label: "Refund orders" });
    expect(registry.all()).toMatchObject([{ id: "orders:refund", pluginId: "acme.shop", defaultRoles: ["administrator"] }]);
    registry.removePlugin("acme.shop");
    expect(registry.all()).toEqual([]);
  });

  it("rejects core overrides, invalid ids, and cross-plugin collisions", () => {
    const registry = new PluginCapabilityRegistry();
    expect(() => registry.register("acme.bad", { id: "users:manage" })).toThrow(/core capability/);
    expect(() => registry.register("acme.bad", { id: "Bad scope" })).toThrow(/domain:action/);
    registry.register("acme.one", { id: "orders:read" });
    expect(() => registry.register("acme.two", { id: "orders:read" })).toThrow(/already registered/);
  });
});
