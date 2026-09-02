import { describe, expect, it } from "vitest";
import { primaryTemplateSlug, templateCandidates, TEMPLATE_SLOTS } from "../template-hierarchy.js";

describe("templateCandidates", () => {
  it("always ends in index", () => {
    const queries = [
      templateCandidates({ kind: "home", frontPageKind: "posts" }),
      templateCandidates({ kind: "home", frontPageKind: "page", slug: "welcome" }),
      templateCandidates({ kind: "singular", contentType: "post", slug: "hello-world" }),
      templateCandidates({ kind: "singular", contentType: "page", slug: "about" }),
      templateCandidates({ kind: "archive", contentType: "product" }),
      templateCandidates({ kind: "search" }),
      templateCandidates({ kind: "notFound" }),
    ];
    for (const list of queries) expect(list[list.length - 1]).toBe("index");
  });

  it("orders a custom-type single from most to least specific", () => {
    expect(
      templateCandidates({ kind: "singular", contentType: "product", slug: "blue-widget" }),
    ).toEqual(["single-product-blue-widget", "single-product", "single", "singular", "index"]);
  });

  it("routes pages through page/singular, never single", () => {
    const list = templateCandidates({ kind: "singular", contentType: "page", slug: "about" });
    expect(list).toEqual(["page-about", "page", "singular", "index"]);
    expect(list).not.toContain("single");
  });

  it("distinguishes a static front page from a posts front page", () => {
    expect(templateCandidates({ kind: "home", frontPageKind: "posts" })).toEqual([
      "front-page",
      "home",
      "index",
    ]);
    expect(templateCandidates({ kind: "home", frontPageKind: "page", slug: "start" })).toEqual([
      "front-page",
      "page-start",
      "page",
      "singular",
      "index",
    ]);
  });

  it("sanitises slugs before interpolating them into a filename", () => {
    const list = templateCandidates({
      kind: "singular",
      contentType: "Post Type!",
      slug: "../../etc/passwd",
    });
    expect(list[0]).toBe("single-post-type-etc-passwd");
    for (const slug of list) expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("never emits duplicate candidates", () => {
    for (const list of [
      templateCandidates({ kind: "singular", contentType: "page", slug: "page" }),
      templateCandidates({ kind: "home", frontPageKind: "page", slug: "" }),
    ]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });
});

describe("primaryTemplateSlug", () => {
  it("is the most specific candidate", () => {
    expect(primaryTemplateSlug({ kind: "notFound" })).toBe("404");
    expect(primaryTemplateSlug({ kind: "singular", contentType: "post", slug: "x" })).toBe(
      "single-post-x",
    );
  });
});

describe("TEMPLATE_SLOTS", () => {
  it("covers every non-parameterised fallback the resolver can emit", () => {
    for (const slot of [
      "front-page",
      "home",
      "single",
      "page",
      "singular",
      "archive",
      "search",
      "404",
      "index",
    ]) {
      expect(TEMPLATE_SLOTS).toContain(slot);
    }
  });
});
