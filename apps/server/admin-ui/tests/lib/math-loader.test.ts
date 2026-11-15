// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { isMathRendererReady } from "@justflows/blocks";
import { loadMathRenderer, renderMathOnDemand } from "../../src/lib/math-loader";

/**
 * The builder loads KaTeX only for documents with a formula
 * (justflows-ce#318). The browser entry of @justflows/blocks does not import
 * it; the loader does, the first time it sees a formula.
 */
describe("math loader", () => {
  it("does not load KaTeX for text without a formula", () => {
    expect(renderMathOnDemand("<p>Plain text</p>")).toBe("<p>Plain text</p>");
    expect(isMathRendererReady()).toBe(false);
  });

  it("shows the source of a formula, loads KaTeX, then typesets it", async () => {
    const html = '<span class="jf-math" data-formula="x^2"></span>';
    expect(renderMathOnDemand(html)).toContain("jf-math--pending");
    await loadMathRenderer();
    expect(isMathRendererReady()).toBe(true);
    expect(renderMathOnDemand(html)).toContain('class="katex"');
  });
});
