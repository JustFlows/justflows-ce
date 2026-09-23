import katex from "katex";

const MATH_SPAN_RE = /<span\b[^>]*\bdata-formula="([^"]*)"[^>]*>[\s\S]*?<\/span>/gi;

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
 */
export function renderMath(html: string): string {
  return html.replace(MATH_SPAN_RE, (match, encodedFormula: string) => {
    const formula = decodeEntities(encodedFormula);
    try {
      const rendered = katex.renderToString(formula, { throwOnError: false, output: "html" });
      // contenteditable="false" is inert on the public site; in the admin canvas it
      // stops the rendered KaTeX markup from being treated as editable text.
      return `<span class="jf-math" data-formula="${encodedFormula}" contenteditable="false">${rendered}</span>`;
    } catch {
      return match;
    }
  });
}
