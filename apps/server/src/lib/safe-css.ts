const MAX_CUSTOM_CSS_BYTES = 32 * 1024;

const BLOCKED_PATTERNS = [
  /@import\b/i,
  /expression\s*\(/i,
  /-moz-binding/i,
  /\bbehavior\s*:/i,
  /javascript\s*:/i,
  /vbscript\s*:/i,
  /url\s*\(\s*['"]?\s*(?:javascript|data|vbscript):/i,
  /<\/style/i,
];

/**
 * Decode CSS escape sequences so the patterns above cannot be stepped around.
 *
 * CSS lets any character in an identifier or at-rule name be written as a
 * backslash escape, and browsers resolve them before matching. Without this,
 * `@\69 mport` and `url(\6a avascript:…)` sail past a literal blocklist while
 * meaning exactly what the blocklist exists to reject.
 *
 * Per CSS Syntax §4.3.7: a backslash followed by 1–6 hex digits, optionally
 * terminated by a single whitespace character; a backslash followed by any
 * other non-newline character is that character literally.
 */
export function decodeCssEscapes(input: string): string {
  return input.replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n\f\r]?|([^\n\r\f]))/g, (_match, hex, literal) => {
    if (hex) {
      const code = Number.parseInt(hex, 16);
      // Surrogates and out-of-range values map to U+FFFD, as browsers do.
      if (!Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        return "�";
      }
      return String.fromCodePoint(code);
    }
    return literal ?? "";
  });
}

/** Remove /* … *​/ comments, which can otherwise split a blocked keyword. */
export function stripCssComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, " ");
}

/**
 * Normalise editor CSS to the form a browser will actually see, so the checks
 * below match on meaning rather than on spelling.
 */
export function normalizeCssForChecks(input: string): string {
  return decodeCssEscapes(stripCssComments(input));
}

/**
 * Strip dangerous constructs from editor-supplied theme CSS.
 *
 * This remains a blocklist, which is inherently weaker than parsing and
 * rebuilding the stylesheet. It is a second line of defence: the CSS is served
 * as a standalone stylesheet, so the realistic damage is a remote fetch or a
 * page-covering overlay rather than script execution, and theme mod values
 * (the other route into theme.css) are validated against an allowlist in
 * theme-customize.ts.
 */
export function sanitizeCustomCss(input: string): string {
  const css = input.trim();
  if (!css) return "";

  if (Buffer.byteLength(css, "utf-8") > MAX_CUSTOM_CSS_BYTES) {
    throw new Error(`Custom CSS exceeds ${MAX_CUSTOM_CSS_BYTES / 1024} KB limit`);
  }

  const normalized = normalizeCssForChecks(css);
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(css) || pattern.test(normalized)) {
      throw new Error("Custom CSS contains disallowed constructs");
    }
  }

  return css;
}
