import { describe, expect, it } from "vitest";
import {
  DEFAULT_INSPECTOR_SUPPORTS,
  coreBlocks,
  resolveInspectorSupports,
} from "../../src/index.js";
import { CORE_INSPECTOR_SUPPORTS, INSPECTOR_FIELDS } from "../../src/inspector.js";

describe("resolveInspectorSupports", () => {
  it("gives an unknown block the defaults", () => {
    expect(resolveInspectorSupports({ type: "acme.thing" })).toEqual({ ...DEFAULT_INSPECTOR_SUPPORTS, hideFields: [] });
  });

  it("applies the core table", () => {
    const spacer = resolveInspectorSupports({ type: "core.spacer" });
    expect(spacer.animation).toBe(false);
    expect(spacer.colors).toBe(false);
    expect(spacer.advanced).toBe(true);
    expect(resolveInspectorSupports({ type: "core.section" }).themeVariables).toBe(false);
    expect(resolveInspectorSupports({ type: "core.paragraph" }).themeVariables).toBe(false);
  });

  it("lets the definition override the core table and defaults", () => {
    const out = resolveInspectorSupports({
      type: "core.spacer",
      inspector: { animation: true, spacing: false },
    });
    expect(out.animation).toBe(true);
    expect(out.spacing).toBe(false);
    expect(out.colors).toBe(false);
  });

  it("ignores non-boolean overrides", () => {
    const out = resolveInspectorSupports({
      type: "acme.thing",
      inspector: { animation: "no" as unknown as boolean },
    });
    expect(out.animation).toBe(true);
  });

  it("hides single fields a block has its own control for", () => {
    expect(resolveInspectorSupports({ type: "core.card" }).hideFields).toEqual(
      expect.arrayContaining(["padTop", "radius", "shadow", "textAlign"]),
    );
    expect(resolveInspectorSupports({ type: "core.paragraph" }).hideFields).toContain("accent");
  });

  it("turns everything off on the reusable placeholder, which never renders itself", () => {
    const out = resolveInspectorSupports({ type: "core.reusable" });
    expect(Object.entries(out).filter(([key, on]) => key !== "hideFields" && on)).toEqual([]);
  });

  it("lets a definition replace the hidden fields and drops unknown names", () => {
    const out = resolveInspectorSupports({
      type: "core.card",
      inspector: { hideFields: ["shadow", "bogus" as never, "shadow"] },
    });
    expect(out.hideFields).toEqual(["shadow"]);
  });

  it("only hides fields that exist", () => {
    const known = new Set<string>(Object.values(INSPECTOR_FIELDS).flat());
    for (const [type, supports] of Object.entries(CORE_INSPECTOR_SUPPORTS)) {
      expect((supports.hideFields ?? []).filter((name) => !known.has(name)), type).toEqual([]);
    }
  });

  it("reviews every shipped core block explicitly", () => {
    expect(Object.keys(CORE_INSPECTOR_SUPPORTS).sort()).toEqual(coreBlocks.map((def) => def.type).sort());
  });

  it("only names block types that exist in core", () => {
    const known = new Set(coreBlocks.map((def) => def.type));
    expect(Object.keys(CORE_INSPECTOR_SUPPORTS).filter((type) => !known.has(type))).toEqual([]);
  });
});
