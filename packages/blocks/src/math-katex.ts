// SPDX-License-Identifier: MIT

import katex from "katex";
import { setMathRenderer } from "./math.js";

/**
 * Typeset formulas with KaTeX. Importing this module is what makes
 * `renderMath` produce typeset math (justflows-ce#318): the package's Node
 * entry imports it, and the admin imports `@justflows/blocks/katex` when a
 * document has a formula.
 */
setMathRenderer((formula) => katex.renderToString(formula, { throwOnError: false, output: "html" }));

export const KATEX_READY = true;
