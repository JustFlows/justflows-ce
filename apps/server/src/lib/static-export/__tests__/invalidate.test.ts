// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { computeAffected } from "../invalidate.js";
import type { ManifestRoute, StaticExportManifest } from "../manifest.js";

function route(path: string, deps: Partial<ManifestRoute["deps"]> = {}): ManifestRoute {
  return {
    path,
    file: `${path === "/" ? "index" : path.slice(1)}.html`,
    status: 200,
    contentType: "text/html",
    bytes: 10,
    sha256: "x",
    cacheControl: "public",
    deps: { content: [], translationGroups: [], dynamicList: false, ...deps },
  };
}

const manifest: StaticExportManifest = {
  generatedAt: "now",
  mode: "full",
  justflowsVersion: "0.0.0",
  publicUrl: "",
  config: { maxPages: 2000, concurrency: 4 },
  assets: [],
  routes: [
    route("/"),
    route("/about", { content: ["c-about"] }),
    route("/blog", { dynamicList: true }),
    route("/contact", { content: ["c-contact"], translationGroups: ["g-contact"] }),
    route("/sitemap.xml"),
  ],
};

describe("computeAffected", () => {
  it("rebuilds everything for a site-wide trigger", () => {
    const sel = computeAffected("theme", manifest);
    expect(sel.all).toBe(true);
    expect(sel.assets).toBe(true);
  });

  it("rebuilds everything for a content change with no known ids", () => {
    expect(computeAffected("content", manifest, {}).all).toBe(true);
  });

  it("targets the pages that embed a changed content id, plus lists and home", () => {
    const sel = computeAffected("content", manifest, { contentIds: ["c-about"] });
    expect(sel.all).toBe(false);
    expect(new Set(sel.paths)).toEqual(new Set(["/", "/about", "/blog", "/sitemap.xml"]));
  });

  it("follows the translation group", () => {
    const sel = computeAffected("content", manifest, { translationGroupIds: ["g-contact"] });
    expect(sel.paths).toContain("/contact");
  });
});
