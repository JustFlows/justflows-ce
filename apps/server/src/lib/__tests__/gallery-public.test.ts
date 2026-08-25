import { describe, expect, it } from "vitest";
import { parseGalleryProps, renderGalleryHtml } from "../gallery-public.js";

describe("parseGalleryProps", () => {
  it("keeps a valid layout, including the newer ones", () => {
    for (const layout of ["grid", "masonry", "carousel", "slideshow", "list"]) {
      expect(parseGalleryProps({ items: [], layout }).layout).toBe(layout);
    }
  });

  it("falls back to grid for anything else — but doesn't lose the block otherwise", () => {
    expect(parseGalleryProps({ items: [], layout: "bogus" }).layout).toBe("grid");
    expect(parseGalleryProps({ items: [], layout: undefined }).layout).toBe("grid");
  });
});

describe("renderGalleryHtml", () => {
  const items = [
    { src: "/uploads/a.jpg", alt: "A", caption: "" },
    { src: "/uploads/b.jpg", alt: "B", caption: "" },
  ];

  it("renders masonry as masonry, not grid (regression: masonry reverting on save)", () => {
    const html = renderGalleryHtml({ items, layout: "masonry", columns: 3 });
    expect(html).toContain("jf-gallery--masonry");
    expect(html).not.toContain("jf-gallery--grid");
  });

  it("renders a carousel track with a slide per item and nav dots", () => {
    const html = renderGalleryHtml({ items, layout: "carousel" });
    expect(html).toContain("jf-carousel__track");
    expect(html).toContain("jf-carousel__dots");
    expect((html.match(/jf-gallery__item/g) ?? []).length).toBe(items.length);
    expect((html.match(/jf-gallery__dot/g) ?? []).length).toBe(items.length);
  });

  it("renders a slideshow stage with one slide per item", () => {
    const html = renderGalleryHtml({ items, layout: "slideshow" });
    expect(html).toContain("jf-slideshow__stage");
    expect((html.match(/jf-gallery__item/g) ?? []).length).toBe(items.length);
  });

  it("omits nav dots for a single-image gallery", () => {
    const html = renderGalleryHtml({ items: items.slice(0, 1), layout: "carousel" });
    expect(html).not.toContain("jf-carousel__dots");
  });

  it("renders a list as a plain stack, ignoring columns", () => {
    const html = renderGalleryHtml({ items, layout: "list", columns: 4 });
    expect(html).toContain("jf-gallery--list");
    expect(html).not.toContain("jf-gallery--cols-4");
  });
});
