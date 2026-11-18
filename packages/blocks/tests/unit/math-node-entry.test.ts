// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";

/**
 * The package's Node entry registers KaTeX on import, so the server and
 * public pages typeset formulas from the first render (justflows-ce#318).
 * Kept in its own file: the renderer is module state.
 */
describe("the Node entry", () => {
  it("typesets formulas in a paragraph without any setup", async () => {
    const { coreBlocks, isMathRendererReady } = await import("../../src/node.js");
    expect(isMathRendererReady()).toBe(true);
    const paragraph = coreBlocks.find((block) => block.type === "core.paragraph");
    const html = paragraph!.render({ text: '<span class="jf-math" data-formula="x^2"></span>' } as never, [] as never);
    expect(html).toContain('class="katex"');
  });
});
