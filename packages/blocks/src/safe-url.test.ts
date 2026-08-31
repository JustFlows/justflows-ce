import { describe, expect, it } from "vitest";
import { esc, safeHref, sanitizeHref, sanitizeMediaSrc } from "./safe-url.js";
import { sanitizePlainText, sanitizeRichText } from "./sanitize.js";

describe("esc", () => {
  it("escapes every character that can end an attribute or a CSS function", () => {
    expect(esc(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("closes the hero background-image breakout", () => {
    // core.hero nests the value in a CSS url(); a bare ' used to end it early.
    expect(esc("https://ok.example/a.png'),url('//evil.example/x")).not.toContain("'");
  });
});

describe("sanitizeHref", () => {
  it("allows http, https, and mailto", () => {
    expect(sanitizeHref("https://example.com/x")).toBe("https://example.com/x");
    expect(sanitizeHref("http://example.com")).toBe("http://example.com");
    // mailto has no "//", so the old scheme check rewrote every one of these to "#".
    expect(sanitizeHref("mailto:hello@example.com")).toBe("mailto:hello@example.com");
  });

  it("allows root-relative paths but not protocol-relative ones", () => {
    expect(sanitizeHref("/about")).toBe("/about");
    expect(sanitizeHref("/a:b/c")).toBe("/a:b/c");
    expect(sanitizeHref("//attacker.example")).toBe("#");
  });

  it("denies scripting and data schemes", () => {
    for (const url of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "  javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "ftp://example.com",
      "file:///etc/passwd",
    ]) {
      expect(sanitizeHref(url), url).toBe("#");
    }
  });

  it("denies by default rather than allowing unknown shapes through", () => {
    expect(sanitizeHref("weird")).toBe("#");
    expect(sanitizeHref("")).toBe("#");
  });
});

describe("sanitizeMediaSrc", () => {
  it("allows only http, https, and root-relative", () => {
    expect(sanitizeMediaSrc("/uploads/a.png")).toBe("/uploads/a.png");
    expect(sanitizeMediaSrc("https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
    expect(sanitizeMediaSrc("javascript:alert(1)")).toBe("");
    expect(sanitizeMediaSrc("//attacker.example/a.png")).toBe("");
  });
});

describe("safeHref", () => {
  it("escapes the result so it is safe in an attribute", () => {
    expect(safeHref("https://example.com/?a=1&b=2")).toBe("https://example.com/?a=1&amp;b=2");
  });
});

describe("sanitizeRichText link handling", () => {
  it("strips protocol-relative hrefs", () => {
    // sanitize-html defaults allowProtocolRelative to true, which bypasses the
    // scheme allowlist entirely.
    expect(sanitizeRichText('<a href="//attacker.example">x</a>')).not.toContain("attacker.example");
  });

  it("keeps ordinary links and forces rel", () => {
    const out = sanitizeRichText('<a href="https://example.com">x</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("still strips javascript: hrefs", () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">x</a>')).not.toContain("javascript");
  });
});

describe("sanitizePlainText", () => {
  it("removes nested and malformed tags without exposing script markup", () => {
    const text = sanitizePlainText('<p>Hello</p><scr<script>ipt>alert(1)</scr</script>ipt>');
    expect(text).not.toContain("<");
    expect(text).not.toContain(">");
    expect(text).toContain("Hello");
  });
});
