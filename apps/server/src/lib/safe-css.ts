// SPDX-License-Identifier: MIT

import { hasUnsafeCss, decodeCssEscapes, normalizeCssForChecks, stripCssComments } from "@justflows/blocks";

const MAX_CUSTOM_CSS_BYTES = 32 * 1024;

// The blocklist and its escape-aware normalisation live in @justflows/blocks so
// theme CSS and per-block CSS cannot drift apart on what counts as dangerous.
export { decodeCssEscapes, normalizeCssForChecks, stripCssComments };

/**
 * Strip dangerous constructs from editor-supplied theme CSS.
 *
 * This remains a blocklist, which is inherently weaker than parsing and
 * rebuilding the stylesheet. It is a second line of defence: the CSS is served
 * as a standalone stylesheet, so the realistic damage is a remote fetch or a
 * page-covering overlay rather than script execution, and theme mod values
 * (the other route into theme.css) are validated against an allowlist in
 * theme-customize.ts.
 *
 * Unlike per-block CSS this throws: a theme-wide stylesheet is saved on its
 * own, so the editor should be told the save failed rather than silently
 * losing what they typed.
 */
export function sanitizeCustomCss(input: string): string {
  const css = input.trim();
  if (!css) return "";

  if (Buffer.byteLength(css, "utf-8") > MAX_CUSTOM_CSS_BYTES) {
    throw new Error(`Custom CSS exceeds ${MAX_CUSTOM_CSS_BYTES / 1024} KB limit`);
  }

  if (hasUnsafeCss(css)) {
    throw new Error("Custom CSS contains disallowed constructs");
  }

  return css;
}
