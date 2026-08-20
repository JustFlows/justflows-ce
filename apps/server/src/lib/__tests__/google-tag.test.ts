import { describe, expect, it } from "vitest";
import {
  buildGoogleTagBody,
  buildGoogleTagHead,
  googleTagInlineHashes,
  parseGoogleTagId,
  withGoogleTagCsp,
} from "../google-tag.js";

describe("parseGoogleTagId", () => {
  it("accepts GA4, Google Ads, and Tag Manager IDs", () => {
    expect(parseGoogleTagId("G-ABC123DEF")).toBe("G-ABC123DEF");
    expect(parseGoogleTagId("gt-XXXXXXXX")).toBe("GT-XXXXXXXX");
    expect(parseGoogleTagId("AW-123456789")).toBe("AW-123456789");
    expect(parseGoogleTagId("GTM-N82XQ")).toBe("GTM-N82XQ");
  });

  it("extracts an ID from a pasted snippet", () => {
    const snippet = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-9XYZ123"></script>
<script>gtag('config', 'G-9XYZ123');</script>`;
    expect(parseGoogleTagId(snippet)).toBe("G-9XYZ123");
  });

  it("rejects arbitrary JavaScript", () => {
    expect(parseGoogleTagId("alert(1)")).toBeNull();
    expect(parseGoogleTagId("<script src='https://evil.example/x.js'></script>")).toBeNull();
    expect(parseGoogleTagId("")).toBeNull();
  });
});

describe("Google tag markup", () => {
  it("loads gtag.js for a GA4 ID and never interpolates raw input", () => {
    const html = buildGoogleTagHead("G-ABC123");
    expect(html).toContain("https://www.googletagmanager.com/gtag/js?id=G-ABC123");
    expect(html).toContain("gtag('config','G-ABC123')");
    expect(buildGoogleTagBody("G-ABC123")).toBe("");
  });

  it("emits the GTM loader and noscript iframe", () => {
    expect(buildGoogleTagHead("GTM-N82XQ")).toContain("GTM-N82XQ");
    expect(buildGoogleTagBody("GTM-N82XQ")).toContain("ns.html?id=GTM-N82XQ");
  });
});

describe("withGoogleTagCsp", () => {
  const base = "default-src 'self'; script-src 'self'";

  it("allows Google hosts and a hash for the inline snippet", () => {
    const hashes = googleTagInlineHashes("G-ABC123");
    const next = withGoogleTagCsp(base, hashes);
    expect(next).toContain("https://www.googletagmanager.com");
    expect(next).toContain("connect-src 'self'");
    expect(next).toContain(hashes[0]);
    expect(next).not.toContain("'unsafe-inline'");
  });

  it("keeps an existing unsafe-inline instead of adding hashes", () => {
    const hashes = googleTagInlineHashes("G-ABC123");
    const next = withGoogleTagCsp("script-src 'self' 'unsafe-inline'", hashes);
    expect(next).toContain("'unsafe-inline'");
    expect(next).not.toContain(hashes[0]);
  });
});
