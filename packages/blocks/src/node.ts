// SPDX-License-Identifier: MIT

/**
 * The package entry for Node: everything in `index.ts`, with formulas
 * typeset by KaTeX from the first render. Browser bundles resolve the
 * `browser` condition to `index.ts` instead and load KaTeX on demand
 * (justflows-ce#318).
 */
import "./math-katex.js";

export * from "./index.js";
