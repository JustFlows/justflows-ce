import { describe, expect, it } from "vitest";
import { buildSeoHeadHtml, jsonLdPayload, seoTextFromContent } from "../seo-public.js";

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

describe("jsonLdPayload", () => {
  it("escapes every character that could break out of a script element", () => {
    const out = jsonLdPayload({ name: "</script><img src=x onerror=alert(1)>" });
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain("&");
    expect(out).toContain("\\u003c");
    expect(JSON.parse(out)).toEqual({ name: "</script><img src=x onerror=alert(1)>" });
  });

  it("escapes the line separators that terminate a JavaScript string", () => {
    const out = jsonLdPayload({ name: "a\u2028b\u2029c" });
    expect(out).not.toContain("\u2028");
    expect(out).not.toContain("\u2029");
    expect(JSON.parse(out)).toEqual({ name: "a\u2028b\u2029c" });
  });
});

describe("buildSeoHeadHtml — script breakout", () => {
  const settings = {
    siteTitle: "Acme",
    titleTemplate: "%s",
    defaultDescription: "",
    twitterHandle: "",
    extraSitemapPaths: [],
  };

  const payload = "</script><img src=x onerror=alert(document.domain)>";

  function ldBlock(html: string): string {
    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    return match![1]!;
  }

  it("does not let a content title close the JSON-LD block", () => {
    const html = buildSeoHeadHtml({ title: payload, path: "/x" }, settings, "https://example.com");
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(ldBlock(html)).not.toContain("<");
    expect(JSON.parse(ldBlock(html)).name).toBe(payload);
  });

  it("does not let an seoImage field close the JSON-LD block", () => {
    const html = buildSeoHeadHtml(
      { title: "Fine", path: "/x", image: payload },
      settings,
      "https://example.com",
    );
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(ldBlock(html)).not.toContain("<");
  });

  it("does not let the request path close the JSON-LD block", () => {
    const html = buildSeoHeadHtml({ title: "Fine", path: `/${payload}` }, settings, "https://e.com");
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(ldBlock(html)).not.toContain("<");
  });

  it("keeps the structured-data description unencoded", () => {
    const html = buildSeoHeadHtml(
      { title: "T", description: "Tools & toys", path: "/x" },
      settings,
      "https://example.com",
    );
    expect(JSON.parse(ldBlock(html)).description).toBe("Tools & toys");
    expect(html).toContain('name="description" content="Tools &amp; toys"');
  });
});
