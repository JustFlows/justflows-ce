import { describe, expect, it } from "vitest";
import {
  blockScopeClass,
  hasUnsafeCss,
  sanitizeBlockClassName,
  sanitizeBlockCss,
  scopeBlockCss,
} from "./safe-css.js";

const SCOPE = ".jf-b-abc";

describe("sanitizeBlockClassName", () => {
  it("keeps ordinary class lists", () => {
    expect(sanitizeBlockClassName("hero-lead  featured_2")).toBe("hero-lead featured_2");
  });

  it("strips anything that could close the attribute or open a tag", () => {
    expect(sanitizeBlockClassName('a" onclick="alert(1)')).toBe("a onclickalert1");
    expect(sanitizeBlockClassName("<script>")).toBe("script");
  });

  it("ignores non-strings", () => {
    expect(sanitizeBlockClassName(42)).toBe("");
    expect(sanitizeBlockClassName(undefined)).toBe("");
  });
});

describe("blockScopeClass", () => {
  it("derives a class from the block id", () => {
    expect(blockScopeClass("3f2a-1b4c")).toBe("jf-b-3f2a-1b4c");
  });

  it("has no class for a block without a usable id", () => {
    expect(blockScopeClass("")).toBe("");
    expect(blockScopeClass(undefined)).toBe("");
    expect(blockScopeClass("../../")).toBe("");
  });
});

describe("sanitizeBlockCss", () => {
  it("rejects constructs that fetch or execute", () => {
    for (const css of [
      "@import url(//attacker.example/x);",
      "background: url(javascript:alert(1))",
      "behavior: url(#default#time2)",
      "width: expression(alert(1))",
      "a { } </style><script>alert(1)</script>",
    ]) {
      expect(sanitizeBlockCss(css), css).toBe("");
      expect(hasUnsafeCss(css), css).toBe(true);
    }
  });

  it("sees through CSS escapes", () => {
    expect(sanitizeBlockCss("@\\69 mport url(//attacker.example/x);")).toBe("");
  });

  it("sees through a comment used where whitespace is legal", () => {
    // A comment cannot split a token — `@im/**/port` is not @import to a
    // browser either — but it can stand in for the whitespace a pattern allows.
    expect(sanitizeBlockCss("& { behavior/**/: url(#default#time2) }")).toBe("");
  });

  it("drops CSS past the size cap", () => {
    expect(sanitizeBlockCss(`a{color:red}`.repeat(2000))).toBe("");
  });
});

describe("scopeBlockCss", () => {
  it("wraps bare declarations for the block itself", () => {
    expect(scopeBlockCss("padding: 2rem; color: red", SCOPE)).toBe(".jf-b-abc {padding: 2rem; color: red}");
  });

  it("substitutes & with the block", () => {
    expect(scopeBlockCss("&:hover { color: red }", SCOPE)).toBe(".jf-b-abc:hover { color: red }");
    expect(scopeBlockCss("& > h2 { color: red }", SCOPE)).toBe(".jf-b-abc > h2 { color: red }");
  });

  it("treats a selector without & as a descendant", () => {
    expect(scopeBlockCss("h2 { color: red }", SCOPE)).toBe(".jf-b-abc h2 { color: red }");
  });

  it("scopes every selector in a list", () => {
    expect(scopeBlockCss("h2, & p { color: red }", SCOPE)).toBe(".jf-b-abc h2, .jf-b-abc p { color: red }");
  });

  it("does not split a comma inside :is()", () => {
    expect(scopeBlockCss(":is(h2, h3) { color: red }", SCOPE)).toBe(".jf-b-abc :is(h2, h3) { color: red }");
  });

  it("scopes inside media queries", () => {
    expect(scopeBlockCss("@media (max-width: 600px) { & { padding: 1rem } }", SCOPE)).toBe(
      "@media (max-width: 600px) {\n.jf-b-abc { padding: 1rem }\n}",
    );
  });

  it("leaves keyframes alone — they are named, not scoped", () => {
    expect(scopeBlockCss("@keyframes spin { to { transform: rotate(1turn) } }", SCOPE)).toContain("@keyframes spin");
  });

  it("cannot reach outside the block", () => {
    const escaped = scopeBlockCss("html { display: none } body * { color: red }", SCOPE);
    expect(escaped).toBe(".jf-b-abc html { display: none }\n.jf-b-abc body * { color: red }");
    expect(escaped.startsWith(".jf-b-abc")).toBe(true);
  });

  it("keeps declarations written alongside rules, as nested CSS does", () => {
    // The panel's own placeholder teaches this shape, so it has to work.
    expect(scopeBlockCss("padding: 3rem 1rem;\n\n& h2 { font-size: 2.5rem }", SCOPE)).toBe(
      ".jf-b-abc {padding: 3rem 1rem;}\n.jf-b-abc h2 { font-size: 2.5rem }",
    );
  });

  it("keeps declarations that trail the last rule", () => {
    expect(scopeBlockCss("& h2 { color: red }\ncolor: blue", SCOPE)).toBe(
      ".jf-b-abc {color: blue;}\n.jf-b-abc h2 { color: red }",
    );
  });

  it("gathers loose declarations from either side of a rule", () => {
    expect(scopeBlockCss("color: red; & h2 { x: 1 } padding: 0", SCOPE)).toBe(
      ".jf-b-abc {color: red; padding: 0;}\n.jf-b-abc h2 { x: 1 }",
    );
  });

  it("keeps loose declarations inside a media query too", () => {
    expect(scopeBlockCss("@media (max-width: 600px) { padding: 1rem }", SCOPE)).toBe(
      "@media (max-width: 600px) {\n.jf-b-abc {padding: 1rem;}\n}",
    );
  });

  it("drops at-rules it cannot scope", () => {
    expect(scopeBlockCss("@charset \"utf-8\"; & { color: red }", SCOPE)).toBe(".jf-b-abc { color: red }");
  });

  it("returns nothing when there is no scope to confine it to", () => {
    expect(scopeBlockCss("color: red", "")).toBe("");
  });

  it("returns nothing for unsafe CSS", () => {
    expect(scopeBlockCss("& { background: url(javascript:alert(1)) }", SCOPE)).toBe("");
  });

  it("never emits a string that closes the style element", () => {
    // Reachable only if unsafe CSS were somehow stored despite the save-time check.
    expect(scopeBlockCss("& { content: '</style>' }", SCOPE)).not.toContain("</style");
  });
});
