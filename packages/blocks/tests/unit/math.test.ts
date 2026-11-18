// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { hasMath, isMathRendererReady, renderMath } from "../../src/math.js";

/**
 * KaTeX is loaded only where it is needed (justflows-ce#318): the module that
 * typesets does not import it, the Node entry does, and until a renderer is
 * registered each formula shows its source.
 */

const FORMULA = '<p>Area: <span class="jf-math" data-formula="a &lt; b^2"></span></p>';

describe("formulas without KaTeX", () => {
  it("detects a formula without typesetting it", () => {
    expect(hasMath(FORMULA)).toBe(true);
    expect(hasMath("<p>No maths here</p>")).toBe(false);
  });

  it("leaves HTML without formulas untouched", () => {
    expect(renderMath("<p>Plain</p>")).toBe("<p>Plain</p>");
  });

  it("shows the escaped LaTeX source until a renderer is registered", () => {
    expect(isMathRendererReady()).toBe(false);
    const html = renderMath(FORMULA);
    expect(html).toContain('class="jf-math jf-math--pending"');
    expect(html).toContain('data-formula="a &lt; b^2"');
    expect(html).toContain(">a &lt; b^2</span>");
    expect(html).not.toContain("katex");
  });
});

describe("formulas with KaTeX", () => {
  it("typeset once the KaTeX module has loaded", async () => {
    await import("../../src/math-katex.js");
    expect(isMathRendererReady()).toBe(true);
    const html = renderMath(FORMULA);
    expect(html).toContain('class="katex"');
    expect(html).not.toContain("jf-math--pending");
  });
});
