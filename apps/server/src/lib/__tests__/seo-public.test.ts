import { describe, expect, it } from "vitest";
import { buildSeoHeadHtml, seoTextFromContent } from "../seo-public.js";

describe("seoTextFromContent", () => {
  it("prefers dedicated SEO fields over title and excerpt", () => {
    expect(
      seoTextFromContent({
        title: "Hello",
        excerpt: "Excerpt",
        fields: {
          seoTitle: "Search title",
          seoDescription: "Search description",
          seoCanonical: "https://example.com/hello",
          seoImage: "/uploads/og.png",
        },
      }),
    ).toEqual({
      title: "Search title",
      description: "Search description",
      canonical: "https://example.com/hello",
      image: "/uploads/og.png",
    });
  });
});

describe("buildSeoHeadHtml", () => {
  const settings = {
    siteTitle: "Acme",
    titleTemplate: "%s — Acme",
    defaultDescription: "Default",
    twitterHandle: "@acme",
    extraSitemapPaths: [],
  };

  it("emits canonical, description, and Open Graph tags", () => {
    const html = buildSeoHeadHtml(
      {
        title: "About",
        description: "About us",
        path: "/about",
        canonical: "https://example.com/about",
        image: "https://example.com/og.png",
      },
      settings,
      "https://example.com",
    );

    expect(html).toContain('rel="canonical" href="https://example.com/about"');
    expect(html).toContain('property="og:image" content="https://example.com/og.png"');
    expect(html).toContain('name="twitter:image"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain("/sitemap.xml");
  });

  it("escapes attribute values", () => {
    const html = buildSeoHeadHtml(
      { title: 'A "quoted" title', path: "/x" },
      settings,
      "https://example.com",
    );
    expect(html).toContain("&quot;");
    expect(html).not.toContain('content="A "quoted"');
  });
});
