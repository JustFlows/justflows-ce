// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResponsiveProp } from "../../../src/lib/media/responsive-media.js";
import {
  responsiveBackground,
  rewriteResponsiveHtml,
  upgradeResponsiveHtml,
  uploadPath,
} from "../../../src/lib/media/responsive-html.js";

const ORIGINAL = process.env.JF_IMAGE_RESPONSIVE_MARKUP;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.JF_IMAGE_RESPONSIVE_MARKUP;
  else process.env.JF_IMAGE_RESPONSIVE_MARKUP = ORIGINAL;
});

const DRESS = "/uploads/site/dress.jpg";
const prop: ResponsiveProp = {
  src: "/uploads/site/dress/1280.jpg",
  width: 1600,
  height: 2000,
  sources: [
    { type: "image/avif", srcset: "/uploads/site/dress/640.avif 640w, /uploads/site/dress/1280.avif 1280w" },
    { type: "image/webp", srcset: "/uploads/site/dress/640.webp 640w, /uploads/site/dress/1280.webp 1280w" },
  ],
  fallbackSrcset: "/uploads/site/dress/640.jpg 640w, /uploads/site/dress/1280.jpg 1280w",
  focalX: 0.4,
  focalY: 0.2,
};

const byUrl = new Map<string, ResponsiveProp>([[DRESS, prop]]);

describe("uploadPath", () => {
  it("keeps library files and drops everything else", () => {
    expect(uploadPath("/uploads/site/a.jpg")).toBe("/uploads/site/a.jpg");
    expect(uploadPath("/uploads/site/a.jpg?v=1")).toBe("/uploads/site/a.jpg");
    expect(uploadPath("/uploads/site/logo.svg")).toBeNull();
    expect(uploadPath("/uploads/../etc/passwd")).toBeNull();
    expect(uploadPath("https://cdn.example/a.jpg")).toBeNull();
  });
});

describe("rewriteResponsiveHtml", () => {
  it("turns a plugin img into picture/srcset and keeps the class and alt", () => {
    const html = `<img class="jf-product-list__img" src="${DRESS}" alt="Pale blue linen wrap maxi dress" />`;
    const out = rewriteResponsiveHtml(html, byUrl);
    expect(out.startsWith('<picture class="jf-responsive" style="display:contents">')).toBe(true);
    expect(out).toContain('type="image/avif"');
    expect(out).toContain('type="image/webp"');
    expect(out).toContain('class="jf-product-list__img"');
    expect(out).toContain('alt="Pale blue linen wrap maxi dress"');
    expect(out).toContain('src="/uploads/site/dress/1280.jpg"');
    expect(out).toContain("1280.avif 1280w");
    expect(out).toContain('width="1600"');
    expect(out).not.toContain("style=\"display:block");
    expect(rewriteResponsiveHtml(out, byUrl)).toBe(out);
  });

  it("leaves an image that is already a picture, already has srcset, or has no derivatives", () => {
    const picture = `<picture><img src="${DRESS}" alt="x"></picture>`;
    const srcset = `<img src="${DRESS}" srcset="/uploads/site/dress/640.jpg 640w" alt="">`;
    const missing = `<img src="/uploads/site/other.jpg" alt="">`;
    const remote = `<img src="https://images.example/a.jpg" alt="">`;
    expect(rewriteResponsiveHtml(picture, byUrl)).toBe(picture);
    expect(rewriteResponsiveHtml(srcset, byUrl)).toBe(srcset);
    expect(rewriteResponsiveHtml(missing, byUrl)).toBe(missing);
    expect(rewriteResponsiveHtml(remote, byUrl)).toBe(remote);
  });

  it("does not rewrite images inside script or comments", () => {
    const html = `<script>const img = '<img src="${DRESS}" alt="">';</script><!-- <img src="${DRESS}" alt=""> -->`;
    expect(rewriteResponsiveHtml(html, byUrl)).toBe(html);
  });

  it("keeps eager loading and an id", () => {
    const html = `<img id="hero-photo" src="${DRESS}" alt="" loading="eager">`;
    const out = rewriteResponsiveHtml(html, byUrl);
    expect(out).toContain('id="hero-photo"');
    expect(out).toContain('loading="eager"');
    expect(out).toContain('fetchpriority="high"');
  });

  it("serves a hero background as image-set and does not rewrite it twice", () => {
    const html = `<section class="jf-hero" style="background-image:url(&quot;${DRESS}&quot;)"></section>`;
    const out = rewriteResponsiveHtml(html, byUrl);
    expect(out).toContain("image-set(");
    expect(out).toContain("1280.avif");
    expect(out).toContain('type(&quot;image/avif&quot;)');
    expect(out).toContain('type(&quot;image/webp&quot;)');
    expect(out).toContain("background-image:url(&quot;/uploads/site/dress/1280.jpg&quot;)");
    expect(rewriteResponsiveHtml(out, byUrl)).toBe(out);
  });

  it("does not stack image-set when the fallback is still the original file", () => {
    const original: ResponsiveProp = { ...prop, src: DRESS, fallbackSrcset: "" };
    const html = `<section style="background-image:url(&quot;${DRESS}&quot;)"></section>`;
    const out = rewriteResponsiveHtml(html, new Map([[DRESS, original]]));
    expect(out.match(/image-set\(/g)).toHaveLength(1);
    expect(rewriteResponsiveHtml(out, new Map([[DRESS, original]]))).toBe(out);
  });
});

describe("responsiveBackground", () => {
  it("falls back to the sized file when there is no modern format", () => {
    expect(
      responsiveBackground({ ...prop, sources: [] }),
    ).toBe('background-image:url(&quot;/uploads/site/dress/1280.jpg&quot;)');
  });
});

describe("upgradeResponsiveHtml", () => {
  it("does nothing when markup is switched off", async () => {
    process.env.JF_IMAGE_RESPONSIVE_MARKUP = "0";
    const load = vi.fn();
    const html = `<img src="${DRESS}" alt="">`;
    await expect(upgradeResponsiveHtml(html, "site-1", load)).resolves.toBe(html);
    expect(load).not.toHaveBeenCalled();
  });

  it("loads derivatives once and rewrites every bare upload", async () => {
    delete process.env.JF_IMAGE_RESPONSIVE_MARKUP;
    const load = vi.fn(async () => byUrl);
    const html = `<img src="${DRESS}" alt="Dress"><img src="/uploads/site/other.jpg" alt="">`;
    const out = await upgradeResponsiveHtml(html, "site-1", load);
    expect(load).toHaveBeenCalledWith([DRESS, "/uploads/site/other.jpg"], "site-1");
    expect(out).toContain("<picture");
    expect(out).toContain('src="/uploads/site/other.jpg"');
  });
});
