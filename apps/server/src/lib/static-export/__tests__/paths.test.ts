// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { isSafeRelativeFile, normalizeUrlPath, urlPathToFile } from "../paths.js";

describe("normalizeUrlPath", () => {
  it("keeps the root path", () => {
    expect(normalizeUrlPath("/")).toBe("/");
  });

  it("strips query, hash and trailing slashes", () => {
    expect(normalizeUrlPath("/about/?utm=x#top")).toBe("/about");
    expect(normalizeUrlPath("/a//b///c/")).toBe("/a/b/c");
  });

  it("accepts an absolute URL and returns its path", () => {
    expect(normalizeUrlPath("https://example.com/nl-NL/over-ons")).toBe("/nl-NL/over-ons");
  });

  it("adds a leading slash", () => {
    expect(normalizeUrlPath("about")).toBe("/about");
  });
});

describe("urlPathToFile", () => {
  it("maps the home page to index.html", () => {
    expect(urlPathToFile("/")).toBe("index.html");
  });

  it("maps an extensionless page to a directory index", () => {
    expect(urlPathToFile("/about")).toBe("about/index.html");
    expect(urlPathToFile("/nl-NL/over-ons")).toBe("nl-NL/over-ons/index.html");
  });

  it("writes files with an extension verbatim", () => {
    expect(urlPathToFile("/sitemap.xml")).toBe("sitemap.xml");
    expect(urlPathToFile("/uploads/logo.png")).toBe("uploads/logo.png");
    expect(urlPathToFile("/robots.txt")).toBe("robots.txt");
  });

  it("treats an HTML response on an odd extension as a page", () => {
    expect(urlPathToFile("/report.2024", "text/html; charset=utf-8")).toBe(
      "report.2024/index.html",
    );
  });
});

describe("isSafeRelativeFile", () => {
  it("rejects traversal and absolute paths", () => {
    expect(isSafeRelativeFile("../evil")).toBe(false);
    expect(isSafeRelativeFile("/etc/passwd")).toBe(false);
    expect(isSafeRelativeFile("a/../b")).toBe(false);
    expect(isSafeRelativeFile("a\\b")).toBe(false);
  });

  it("accepts a normal nested file", () => {
    expect(isSafeRelativeFile("nl-NL/over-ons/index.html")).toBe(true);
  });
});
