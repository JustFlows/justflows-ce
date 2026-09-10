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

  it("emits a plain <img> when no responsive derivatives are injected", () => {
    const html = renderGalleryHtml({ items, layout: "grid", columns: 3 });
    expect(html).toContain('<img src="/uploads/a.jpg" alt="A" loading="lazy">');
    expect(html).not.toContain("<picture>");
  });

  it("emits <picture>/srcset for items with injected derivatives", () => {
    const responsive = {
      "/uploads/a.jpg": {
        src: "/uploads/a/1280.jpg",
        width: 1600,
        height: 1200,
        sources: [
          { type: "image/webp", srcset: "/uploads/a/640.webp 640w, /uploads/a/1280.webp 1280w" },
        ],
        fallbackSrcset: "/uploads/a/640.jpg 640w, /uploads/a/1280.jpg 1280w",
        focalX: null,
        focalY: null,
      },
    };
    const html = renderGalleryHtml({
      items: [{ src: "/uploads/a.jpg", alt: "A", caption: "" }],
      layout: "grid",
      columns: 3,
      lightbox: true,
      responsive,
    });
    expect(html).toContain("<picture>");
    expect(html).toContain('<source type="image/webp"');
    expect(html).toContain('width="1600"');
    // grid at 3 columns → layout-aware sizes
    expect(html).toContain('sizes="(max-width: 600px) 100vw, 33vw"');
    // both the thumbnail and the lightbox image are upgraded
    expect((html.match(/<picture>/g) ?? []).length).toBe(2);
  });

  it("keeps the responsive markup through a parse round-trip (block render double-parses)", () => {
    const responsive = {
      "/uploads/a.jpg": {
        src: "/uploads/a/1280.jpg",
        width: 1600,
        height: 1200,
        sources: [{ type: "image/webp", srcset: "/uploads/a/1280.webp 1280w" }],
        fallbackSrcset: "/uploads/a/1280.jpg 1280w",
        focalX: null,
        focalY: null,
      },
    };
    // Mirrors BlockRegistry.renderNode: validateProps (parseGalleryProps) then
    // render (renderGalleryHtml, which parses again).
    const parsed = parseGalleryProps({
      items: [{ src: "/uploads/a.jpg", alt: "A", caption: "" }],
      layout: "grid",
      columns: 3,
      responsive,
    });
    expect(parsed.items[0]!.responsive).toBeDefined();
    const html = renderGalleryHtml(parsed);
    expect(html).toContain("<picture>");
    expect(html).toContain('<source type="image/webp"');
  });

  it("ignores a malformed responsive value instead of throwing", () => {
    const html = renderGalleryHtml({
      items: [{ src: "/uploads/a.jpg", alt: "A", caption: "", responsive: { sources: "nope" } }],
      layout: "grid",
      columns: 3,
    });
    expect(html).toContain('<img src="/uploads/a.jpg"');
    expect(html).not.toContain("<picture>");
  });
});
