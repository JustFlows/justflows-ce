import { describe, expect, it } from "vitest";
import { buildFaviconHeadHtml, faviconMime, isSafeAssetUrl, sanitizeFaviconUrl } from "../favicon.js";

describe("isSafeAssetUrl", () => {
  it("allows site-relative uploads", () => {
    expect(isSafeAssetUrl("/uploads/abc/icon.png")).toBe(true);
  });

  it("allows http(s) URLs", () => {
    expect(isSafeAssetUrl("https://cdn.example.com/icon.png")).toBe(true);
  });

  it("rejects script URLs and protocol-relative paths", () => {
    expect(isSafeAssetUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeAssetUrl("//evil.example/x.ico")).toBe(false);
    expect(isSafeAssetUrl("")).toBe(false);
  });
});

describe("buildFaviconHeadHtml", () => {
  it("emits icon and apple-touch links", () => {
    const html = buildFaviconHeadHtml("/uploads/site/icon.png");
    expect(html).toContain('rel="icon"');
    expect(html).toContain('type="image/png"');
    expect(html).toContain('href="/uploads/site/icon.png"');
    expect(html).toContain('rel="apple-touch-icon"');
  });

  it("escapes quotes in the href", () => {
    const html = buildFaviconHeadHtml('/uploads/"onload="alert(1).png');
    expect(html).not.toContain('onload="alert');
    expect(html).toContain("&quot;");
  });

  it("returns empty for unsafe URLs", () => {
    expect(buildFaviconHeadHtml("javascript:alert(1)")).toBe("");
  });
});

describe("faviconMime", () => {
  it("maps common extensions", () => {
    expect(faviconMime("/a.svg")).toBe("image/svg+xml");
    expect(faviconMime("/a.ico?v=1")).toBe("image/x-icon");
  });
});

describe("sanitizeFaviconUrl", () => {
  it("trims and drops unsafe values", () => {
    expect(sanitizeFaviconUrl("  /uploads/icon.png  ")).toBe("/uploads/icon.png");
    expect(sanitizeFaviconUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeFaviconUrl(undefined)).toBe("");
  });
});
