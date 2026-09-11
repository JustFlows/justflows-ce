// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { renderResponsiveImage, sanitizeSizes, sanitizeSrcset } from "./responsive-image.js";

describe("sanitizeSizes", () => {
  it("keeps media queries and lengths", () => {
    expect(sanitizeSizes("(max-width: 600px) 100vw, 50vw")).toBe("(max-width: 600px) 100vw, 50vw");
  });

  it("rejects delimiters that could break out of the attribute", () => {
    expect(sanitizeSizes('100vw"><script>')).toBe("");
    expect(sanitizeSizes("calc(100% - 1px); color:red")).toBe("");
    expect(sanitizeSizes("x".repeat(400))).toBe("");
  });
});

describe("sanitizeSrcset", () => {
  it("keeps safe url + descriptor pairs and drops the rest", () => {
    const out = sanitizeSrcset(
      "/uploads/a.webp 320w, https://cdn.example/b.webp 2x, javascript:alert(1) 640w, /uploads/c.webp bogus",
    );
    expect(out).toBe("/uploads/a.webp 320w, https://cdn.example/b.webp 2x");
  });
});

describe("renderResponsiveImage", () => {
  it("returns an empty string for an unsafe src", () => {
    expect(renderResponsiveImage({ src: "javascript:alert(1)" })).toBe("");
  });

  it("renders a bare <img> with lazy + async defaults when there are no sources", () => {
    const html = renderResponsiveImage({
      src: "/uploads/a.jpg",
      alt: "A",
      width: 800,
      height: 600,
    });
    expect(html.startsWith("<img ")).toBe(true);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('width="800"');
    expect(html).toContain('height="600"');
  });

  it("wraps in <picture> when modern sources are supplied", () => {
    const html = renderResponsiveImage({
      src: "/uploads/a.jpg",
      alt: "A",
      sizes: "100vw",
      sources: [
        { type: "image/avif", srcset: "/uploads/a-640.avif 640w" },
        { type: "image/webp", srcset: "/uploads/a-640.webp 640w" },
      ],
    });
    expect(html.startsWith("<picture>")).toBe(true);
    expect(html.indexOf('type="image/avif"')).toBeLessThan(html.indexOf('type="image/webp"'));
    expect(html).toContain('sizes="100vw"');
  });

  it("escapes the alt text", () => {
    const html = renderResponsiveImage({ src: "/uploads/a.jpg", alt: '"><b>x</b>' });
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&quot;&gt;&lt;b&gt;");
  });
});
