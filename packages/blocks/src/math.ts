// SPDX-License-Identifier: MIT

import { esc } from "./safe-url.js";

/**
 * Formulas are typeset by KaTeX (about 259 KB), which this module does not
 * import, so a browser bundle only pays for it when a page has a formula
 * (justflows-ce#318). `math-katex.ts` registers the renderer: the Node entry
 * of the package imports it, so the server and public pages always typeset;
 * the admin loads it on demand and shows the formula source until then.
 */
export type MathRenderer = (formula: string) => string;

let mathRenderer: MathRenderer | null = null;

/** Install the function that turns a LaTeX formula into HTML. */
export function setMathRenderer(renderer: MathRenderer | null): void {
  mathRenderer = renderer;
}

/** Whether formulas are typeset now, rather than shown as their source. */
export function isMathRendererReady(): boolean {
  return mathRenderer !== null;
}

const MATH_SPAN_RE = /<span\b[^>]*\bdata-formula="([^"]*)"[^>]*>[\s\S]*?<\/span>/gi;

const HAS_MATH_RE = /\bdata-formula=/i;

/** Whether rich-text HTML holds a formula, without typesetting it. */
export function hasMath(html: string): boolean {
  return HAS_MATH_RE.test(html);
}

const ENTITY_RE = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi;

/** Undo HTML entity escaping applied when an attribute value was serialized. */
function decodeEntities(raw: string): string {
  return raw.replace(ENTITY_RE, (entity, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1]?.toLowerCase() === "x"
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : entity;
    }
    return (
      ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }) as Record<string, string>
    )[code.toLowerCase()] ?? entity;
  });
}

/**
 * Replace every `<span class="jf-math" data-formula="…">` left by the editor
 * with KaTeX's rendered markup. Pure and isomorphic — `katex.renderToString`
 * needs no DOM, so this runs identically server-side (public pages) and
 * client-side (the admin canvas preview).
 *
 * Without a registered renderer each formula shows its LaTeX source, marked
 * `jf-math--pending`, so nothing is lost while KaTeX loads.
 */
export function renderMath(html: string): string {
  if (!hasMath(html)) return html;
  return html.replace(MATH_SPAN_RE, (match, encodedFormula: string) => {
    const formula = decodeEntities(encodedFormula);
    if (!mathRenderer) {
      return `<span class="jf-math jf-math--pending" data-formula="${encodedFormula}" contenteditable="false">${esc(formula)}</span>`;
    }
    try {
      const rendered = mathRenderer(formula);
      /**
       * contenteditable="false" is inert on the public site; in the admin
       * canvas it stops the rendered KaTeX markup from being treated as
       * editable text.
       */
      return `<span class="jf-math" data-formula="${encodedFormula}" contenteditable="false">${rendered}</span>`;
    } catch {
      return match;
    }
  });
}
