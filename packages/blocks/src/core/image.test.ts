// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { coreBlocks } from "./index.js";

const image = coreBlocks.find((block) => block.type === "core.image")!;

describe("core.image sizing", () => {
  it("keeps older image blocks on automatic sizing", () => {
    expect(image.validateProps({ src: "/logo.png", alt: "Logo" })).toMatchObject({
      width: 0,
      height: 0,
      objectFit: "contain",
    });
  });

  it("renders bounded dimensions and an allowed fit mode", () => {
    const props = image.validateProps({
      src: "/logo.png",
      alt: "Logo",
      width: 320,
      height: 180,
      objectFit: "cover",
    });
    const html = image.render(props);

    expect(html).toContain("width:320px");
    expect(html).toContain("height:180px");
    expect(html).toContain("object-fit:cover");
  });

  it("rejects unsafe fit values and clamps dimensions", () => {
    expect(
      image.validateProps({ width: -1, height: 20000, objectFit: "none;position:fixed" }),
    ).toMatchObject({
      width: 0,
      height: 10000,
      objectFit: "contain",
    });
  });
});

describe("core.image responsive markup", () => {
  it("emits lazy loading and async decoding by default", () => {
    const html = image.render(image.validateProps({ src: "/uploads/a.jpg", alt: "A" }));
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).not.toContain("<picture>");
  });

  it("opts out of lazy loading for above-the-fold images", () => {
    const html = image.render(
      image.validateProps({ src: "/uploads/a.jpg", alt: "A", loading: "eager" }),
    );
    expect(html).toContain('loading="eager"');
    expect(html).toContain('fetchpriority="high"');
  });

  it("builds a <picture> with modern-format sources and intrinsic dimensions", () => {
    const props = image.validateProps({
      src: "/uploads/s/m/orig.jpg",
      alt: "Hero",
      sizes: "(max-width: 800px) 100vw, 800px",
      responsive: {
        src: "/uploads/s/m/1280.jpg",
        width: 1600,
        height: 900,
        fallbackSrcset: "/uploads/s/m/640.jpg 640w, /uploads/s/m/1280.jpg 1280w",
        sources: [
          {
            type: "image/webp",
            srcset: "/uploads/s/m/640.webp 640w, /uploads/s/m/1280.webp 1280w",
          },
        ],
      },
    });
    const html = image.render(props);
    expect(html).toContain("<picture>");
    expect(html).toContain('<source type="image/webp"');
    expect(html).toContain('width="1600"');
    expect(html).toContain('height="900"');
    expect(html).toContain('sizes="(max-width: 800px) 100vw, 800px"');
    expect(html).toContain('src="/uploads/s/m/1280.jpg"');
  });

  it("drops srcset candidates with unsafe URLs or bad descriptors", () => {
    const props = image.validateProps({
      src: "/uploads/ok.jpg",
      alt: "",
      responsive: {
        sources: [
          {
            type: "image/webp",
            srcset: "javascript:alert(1) 640w, /uploads/ok.webp 1280w, /uploads/bad.webp 99z",
          },
        ],
      },
    });
    const html = image.render(props);
    expect(html).toContain("/uploads/ok.webp 1280w");
    expect(html).not.toContain("javascript:alert");
    expect(html).not.toContain("99z");
  });

  it("positions the subject with a focal point on cover crops", () => {
    const props = image.validateProps({
      src: "/uploads/ok.jpg",
      alt: "",
      width: 400,
      height: 300,
      objectFit: "cover",
      responsive: { src: "/uploads/ok.jpg", focalX: 0.25, focalY: 0.8 },
    });
    const html = image.render(props);
    expect(html).toContain("object-fit:cover");
    expect(html).toContain("object-position:25.00% 80.00%");
  });
});
