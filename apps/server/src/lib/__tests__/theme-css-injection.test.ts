import { describe, expect, it } from "vitest";
import {
  buildThemeStylesheet,
  isSafeCssColor,
  isSafeCssFontStack,
  isSafeCssVariableName,
  modsToCssVariables,
} from "../theme-customize.js";

describe("isSafeCssColor", () => {
  it("accepts the formats the colour picker produces", () => {
    for (const value of ["#fff", "#3b82f6", "#3b82f6ff", "rgb(59, 130, 246)", "rgba(0,0,0,.5)", "hsl(217 91% 60%)", "transparent", "rebeccapurple"]) {
      expect(isSafeCssColor(value), value).toBe(true);
    }
  });

  it("rejects anything that can end the declaration or open a rule", () => {
    for (const value of [
      "red } body { background: url(//attacker.example/x) } x {",
      "red; background: url(//attacker.example/x)",
      "url(//attacker.example/x)",
      "red /* } */",
      "@import url(//attacker.example/x)",
      "expression(alert(1))",
      "red\\3b background:red",
    ]) {
      expect(isSafeCssColor(value), value).toBe(false);
    }
  });
});

describe("isSafeCssFontStack", () => {
  it("accepts the shipped presets", () => {
    for (const value of [
      "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      '"Inter", system-ui, sans-serif',
      'ui-monospace, "Cascadia Code", Consolas, monospace',
    ]) {
      expect(isSafeCssFontStack(value), value).toBe(true);
    }
  });

  it("rejects rule injection", () => {
    expect(isSafeCssFontStack("sans-serif } html { display:none } x {")).toBe(false);
    expect(isSafeCssFontStack("sans-serif; background: red")).toBe(false);
  });
});

describe("isSafeCssVariableName", () => {
  it("accepts custom properties only", () => {
    expect(isSafeCssVariableName("--color-primary")).toBe(true);
    expect(isSafeCssVariableName("color-primary")).toBe(false);
    expect(isSafeCssVariableName("--x; } body {")).toBe(false);
    expect(isSafeCssVariableName("}\nbody{background:red")).toBe(false);
  });
});

describe("modsToCssVariables", () => {
  it("keeps valid overrides", () => {
    const vars = modsToCssVariables({}, { colors: { "--color-primary": "#ff0000" } });
    expect(vars["--color-primary"]).toBe("#ff0000");
  });

  it("falls back to the default when a colour is malicious", () => {
    const vars = modsToCssVariables(
      {},
      { colors: { "--color-primary": "red } body { background: url(//evil.example/x) } x {" } },
    );
    expect(vars["--color-primary"]).toBe("#3b82f6");
  });

  it("ignores an injected declaration smuggled through the key", () => {
    const vars = modsToCssVariables({}, { colors: { "--x; } body { display:none": "#fff" } });
    expect(Object.keys(vars).some((k) => k.includes("}"))).toBe(false);
  });

  it("clamps range controls instead of interpolating a string", () => {
    const vars = modsToCssVariables({}, { layout: { contentWidth: "1; } html { display:none } x {" } });
    expect(vars["--max-width"]).toBe("720px");

    expect(modsToCssVariables({}, { layout: { contentWidth: 99999 } })["--max-width"]).toBe("1200px");
    expect(modsToCssVariables({}, { typography: { baseFontSize: -5 } })["--base-font-size"]).toBe("14px");
  });
});

describe("buildThemeStylesheet", () => {
  it("never emits a declaration that closes the :root block", () => {
    const css = buildThemeStylesheet(
      modsToCssVariables(
        // A malicious theme package supplying css_variables directly.
        { "--ok": "1rem", "--evil": "red } body { display:none } x {", "}body{color:red": "x" },
        { colors: { "--color-bg": "#000 } * { display:none } x {" } },
      ),
    );
    expect(css).not.toContain("display:none");
    expect(css.match(/\{/g)).toHaveLength(2); // :root { and html {
    expect(css).toContain("--ok: 1rem;");
  });
});
