// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { scopeThemeCss } from "../scope-css.js";

const S = ".jf-theme-surface";

describe("scopeThemeCss", () => {
  it("turns :root into the wrapper so tokens cascade to the subtree", () => {
    expect(scopeThemeCss(":root { --color-primary: #ff0080; }", S)).toBe(
      `${S} { --color-primary: #ff0080; }`,
    );
  });

  it("folds html / body / html[data-theme] onto the wrapper", () => {
    expect(scopeThemeCss("html { font-size: 16px; }", S)).toBe(`${S} { font-size: 16px; }`);
    expect(scopeThemeCss("body { margin: 0; }", S)).toBe(`${S} { margin: 0; }`);
    expect(scopeThemeCss('html[data-theme="dark"] { --x: 1; }', S)).toBe(
      `${S}[data-theme="dark"] { --x: 1; }`,
    );
  });

  it("prefixes ordinary selectors, each part of a list", () => {
    expect(scopeThemeCss(".jf-hero, .jf-cta h2 { color: red; }", S)).toBe(
      `${S} .jf-hero, ${S} .jf-cta h2 { color: red; }`,
    );
  });

  it("keeps the universal reset bounded by the wrapper", () => {
    expect(scopeThemeCss("*, *::before, *::after { box-sizing: border-box; }", S)).toBe(
      `${S} *, ${S} *::before, ${S} *::after { box-sizing: border-box; }`,
    );
  });

  it("leaves @keyframes and @font-face global", () => {
    const kf = "@keyframes spin { to { transform: rotate(1turn); } }";
    expect(scopeThemeCss(kf, S)).toBe(kf);
  });

  it("recurses into @media / @supports bodies", () => {
    const input = "@media (max-width: 600px) { .jf-hero { padding: 1rem; } :root { --x: 2; } }";
    const out = scopeThemeCss(input, S);
    expect(out.startsWith("@media (max-width: 600px) {")).toBe(true);
    expect(out).toContain(`${S} .jf-hero { padding: 1rem; }`);
    expect(out).toContain(`${S} { --x: 2; }`);
    expect(out.trimEnd().endsWith("}")).toBe(true);
  });

  it("is not fooled by braces or comments inside values", () => {
    const input = '.a { content: "}"; background: url(x); } /* } */ .b { color: red; }';
    const out = scopeThemeCss(input, S);
    expect(out).toContain(`${S} .a { content: "}"; background: url(x); }`);
    expect(out).toContain(`${S} .b { color: red; }`);
  });

  it("drops @import but keeps other at-statements", () => {
    expect(scopeThemeCss('@import "evil.css"; .a { color: red; }', S)).toBe(
      `${S} .a { color: red; }`,
    );
  });

  it("returns the CSS untouched for an unsafe scope selector", () => {
    const css = ":root { --x: 1; }";
    expect(scopeThemeCss(css, "body{}")).toBe(css);
    expect(scopeThemeCss(css, "div")).toBe(css);
  });
});
