import { describe, expect, it } from "vitest";
import {
  detectStaticErrorLocale,
  escapeStaticHtml,
  renderStaticErrorPage,
  STATIC_ERROR_LOCALES,
} from "../static-error-page.js";

describe("detectStaticErrorLocale", () => {
  it("prefers the URL's locale prefix", () => {
    expect(detectStaticErrorLocale("/de/some/path", "en-US")).toBe("de");
    expect(detectStaticErrorLocale("/fr-FR/some/path", null)).toBe("fr");
  });

  it("falls back to Accept-Language when the path has no locale prefix", () => {
    expect(detectStaticErrorLocale("/some/path", "nl-NL,nl;q=0.9,en;q=0.8")).toBe("nl");
  });

  it("defaults to English when nothing matches a bundled locale", () => {
    expect(detectStaticErrorLocale("/xx/some/path", "zz-ZZ")).toBe("en");
    expect(detectStaticErrorLocale("/", undefined)).toBe("en");
  });

  it("only ever returns a bundled locale", () => {
    for (const locale of ["en", "de", "es", "fr", "nl", "xx", ""]) {
      expect(STATIC_ERROR_LOCALES as readonly string[]).toContain(
        detectStaticErrorLocale(`/${locale}/path`, null),
      );
    }
  });
});

describe("escapeStaticHtml", () => {
  it("escapes the five HTML-significant characters, not a broader tag-stripping regex", () => {
    expect(escapeStaticHtml(`<script>alert("x")</script>&'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;",
    );
  });
});

describe("renderStaticErrorPage", () => {
  it("renders without any database, cache, or plugin dependency", () => {
    // No mocking of getDb/getSiteSetting/etc. here — this is the literal proof
    // that the dependency-free path (justflows-ce#92) never touches them.
    const html = renderStaticErrorPage("500");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Something went wrong");
  });

  it("falls back to generic English copy when the requested locale is unknown", () => {
    const html = renderStaticErrorPage("maintenance", { locale: "xx" });
    expect(html).toContain("We&#39;ll be back soon");
  });

  it("uses the bundled locale's default copy when no admin text is set", () => {
    const html = renderStaticErrorPage("500", { locale: "de" });
    expect(html).toContain("Etwas ist schiefgelaufen");
  });

  it("escapes admin-provided heading/message instead of interpolating them raw", () => {
    const html = renderStaticErrorPage("500", {
      heading: `<img src=x onerror=alert(1)>`,
      message: `<script>alert(document.cookie)</script>`,
    });
    expect(html).not.toContain("<img src=x onerror");
    expect(html).not.toContain("<script>alert(document.cookie)</script>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("never leaves the {{TOKEN}} placeholders unsubstituted", () => {
    const html = renderStaticErrorPage("500", { siteTitle: "" });
    expect(html).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
});
