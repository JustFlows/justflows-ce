// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assetTags,
  blockAssetTagsFor,
  buildBundle,
  readBlockAssets,
  safeAssetRel,
  servableAssetRel,
} from "../../../src/lib/plugins/plugin-assets.js";

describe("safeAssetRel", () => {
  it("accepts relative .js/.mjs/.css paths", () => {
    expect(safeAssetRel("widget.js")).toBe("widget.js");
    expect(safeAssetRel("a/b/c.mjs")).toBe("a/b/c.mjs");
    expect(safeAssetRel("theme.css")).toBe("theme.css");
  });

  it("rejects traversal, absolute paths and other extensions", () => {
    expect(safeAssetRel("../secret.js")).toBeNull();
    expect(safeAssetRel("a/../b.js")).toBeNull();
    expect(safeAssetRel("/etc/passwd.js")).toBeNull();
    expect(safeAssetRel("run.sh")).toBeNull();
    expect(safeAssetRel("script.js.map")).toBeNull();
    expect(safeAssetRel(42)).toBeNull();
  });
});

describe("servableAssetRel", () => {
  it("serves scripts, stylesheets, and images", () => {
    expect(servableAssetRel("product.js")).toBe("product.js");
    expect(servableAssetRel("img/product-placeholder.svg")).toBe("img/product-placeholder.svg");
    expect(servableAssetRel("photo.JPG")).toBe("photo.JPG");
  });

  it("rejects other files and unsafe paths", () => {
    for (const bad of ["../secret.svg", "a/../../b.png", "/abs.png", "data.json", "page.html", ""]) {
      expect(servableAssetRel(bad), bad).toBeNull();
    }
  });

  it("never enqueues an image as a script or stylesheet", () => {
    expect(safeAssetRel("product-placeholder.svg")).toBeNull();
  });
});

describe("assetTags", () => {
  it("renders deferred script and stylesheet tags under /ext/<pluginId>/", () => {
    const html = assetTags("justflows.widget", {
      scripts: ["widget.js", "extra/init.js"],
      styles: ["widget.css"],
    });
    expect(html).toContain('<link rel="stylesheet" href="/ext/justflows.widget/widget.css">');
    expect(html).toContain('<script src="/ext/justflows.widget/widget.js" defer></script>');
    expect(html).toContain('<script src="/ext/justflows.widget/extra/init.js" defer></script>');
  });

  it("drops unsafe entries and rejects a bad plugin id", () => {
    expect(assetTags("justflows.widget", { scripts: ["../x.js", "ok.js"] })).toBe(
      '<script src="/ext/justflows.widget/ok.js" defer></script>',
    );
    expect(assetTags("Not A Plugin Id", { scripts: ["ok.js"] })).toBe("");
  });

  it("returns an empty string when nothing is declared", () => {
    expect(assetTags("justflows.widget", {})).toBe("");
  });
});

describe("buildBundle", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "jf-bundle-"));
    writeFileSync(path.join(dir, "a.js"), "window.__a = 1");
    writeFileSync(path.join(dir, "b.js"), "window.__b = 2;");
    writeFileSync(path.join(dir, "a.css"), ".a{color:red}");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("concatenates scripts, IIFE-wraps each, and content-hashes", () => {
    const bundle = buildBundle(
      [
        { pluginId: "justflows.one", baseDir: dir, scripts: ["a.js"], styles: [] },
        { pluginId: "justflows.two", baseDir: dir, scripts: ["b.js"], styles: [] },
      ],
      "js",
    )!;
    expect(bundle.code).toContain("/* justflows.one/a.js */");
    expect(bundle.code).toContain("/* justflows.two/b.js */");
    expect(bundle.code).toContain("(function(){\nwindow.__a = 1\n})();");
    expect(bundle.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(bundle.contentType).toContain("javascript");
  });

  it("is deterministic and changes with content", () => {
    const sets = [{ pluginId: "justflows.one", baseDir: dir, scripts: ["a.js"], styles: [] }];
    const h1 = buildBundle(sets, "js")!.hash;
    const h2 = buildBundle(sets, "js")!.hash;
    expect(h1).toBe(h2);
    const h3 = buildBundle(
      [{ pluginId: "justflows.one", baseDir: dir, scripts: ["a.js", "b.js"], styles: [] }],
      "js",
    )!.hash;
    expect(h3).not.toBe(h1);
  });

  it("concatenates styles without the IIFE wrapper", () => {
    const bundle = buildBundle(
      [{ pluginId: "justflows.one", baseDir: dir, scripts: [], styles: ["a.css"] }],
      "css",
    )!;
    expect(bundle.code).toContain(".a{color:red}");
    expect(bundle.code).not.toContain("function()");
    expect(bundle.contentType).toContain("css");
  });

  it("returns null when there is nothing to bundle", () => {
    expect(buildBundle([], "js")).toBeNull();
    expect(
      buildBundle([{ pluginId: "justflows.one", baseDir: dir, scripts: [], styles: [] }], "js"),
    ).toBeNull();
  });
});

describe("per-block assets", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "jf-block-assets-"));
    writeFileSync(path.join(dir, "slider.js"), "window.__slider = 1;");
    writeFileSync(path.join(dir, "slider.css"), ".slider{}");
    writeFileSync(path.join(dir, "map.js"), "window.__map = 1;");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps only the plugin's own block types and existing files, with a content version each", () => {
    const { blocks, versions } = readBlockAssets("acme.widgets", dir, {
      "acme.widgets.slider": { scripts: ["slider.js", "missing.js"], styles: ["slider.css"] },
      "other.plugin.block": { scripts: ["map.js"] },
      "core.gallery": { scripts: ["map.js"] },
      "acme.widgets.empty": { scripts: ["../escape.js"] },
    });
    expect(blocks).toEqual([{ type: "acme.widgets.slider", scripts: ["slider.js"], styles: ["slider.css"] }]);
    expect(versions.get("slider.js")).toMatch(/^[0-9a-f]{12}$/);
    expect(versions.has("map.js")).toBe(false);
  });

  it("links a block's assets only when the page contains that block, once per file", () => {
    const sets = [
      {
        pluginId: "acme.widgets",
        ...readBlockAssets("acme.widgets", dir, {
          "acme.widgets.slider": { scripts: ["slider.js"], styles: ["slider.css"] },
          "acme.widgets.carousel": { scripts: ["slider.js"] },
          "acme.widgets.map": { scripts: ["map.js"] },
        }),
      },
    ];
    const page = "<main><div>a</div><!--jf-block:acme.widgets.slider--><div>b</div><!--jf-block:acme.widgets.carousel--></main>";
    const tags = blockAssetTagsFor(sets, page);
    expect(tags.styles).toEqual([expect.stringMatching(/^<link rel="stylesheet" href="\/ext\/acme\.widgets\/slider\.css\?v=[0-9a-f]{12}">$/)]);
    expect(tags.body).toEqual([expect.stringMatching(/^<script src="\/ext\/acme\.widgets\/slider\.js\?v=[0-9a-f]{12}" defer><\/script>$/)]);
    expect(blockAssetTagsFor(sets, "<main>no plugin blocks</main>")).toEqual({ styles: [], body: [] });
  });
});

describe("markup assets", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "jf-markup-assets-"));
    writeFileSync(path.join(dir, "shop.js"), "window.__shop = 1;");
    writeFileSync(path.join(dir, "shop.css"), ".jf-shop{}");
    writeFileSync(path.join(dir, "forms.js"), "window.__forms = 1;");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps rules with valid selectors and existing files", () => {
    const { markup } = readBlockAssets("acme.shop", dir, undefined, [
      { match: ["#jf-cart-page", "[data-jf-purchase]", ".jf-product-*", "div > p", "#1bad"], scripts: ["shop.js"], styles: ["shop.css", "missing.css"] },
      { match: ["nonsense selector"], scripts: ["shop.js"] },
      { match: [".jf-x"], scripts: ["../escape.js"] },
    ]);
    expect(markup).toEqual([{ match: ["#jf-cart-page", "[data-jf-purchase]", ".jf-product-*"], scripts: ["shop.js"], styles: ["shop.css"] }]);
  });

  it("links a rule's files only on pages that contain one of its selectors", () => {
    const sets = [
      { pluginId: "acme.shop", ...readBlockAssets("acme.shop", dir, undefined, [
        { match: ["#jf-cart-page", "[data-jf-purchase]", ".jf-product-*"], scripts: ["shop.js"], styles: ["shop.css"] },
      ]) },
      { pluginId: "acme.forms", ...readBlockAssets("acme.forms", dir, undefined, [{ match: ["[data-jf-form]"], scripts: ["forms.js"] }]) },
    ];
    const pageWith = (html: string) => blockAssetTagsFor(sets, `<main>${html}</main>`);
    expect(pageWith('<div id="jf-cart-page" class="jf-cart-page"></div>').body).toHaveLength(1);
    expect(pageWith('<div class="card jf-product-gallery__thumbs"></div>').styles).toHaveLength(1);
    expect(pageWith('<div class="jf-form" data-jf-form="contact"></div>').body).toEqual([
      expect.stringMatching(/^<script src="\/ext\/acme\.forms\/forms\.js\?v=[0-9a-f]{12}" defer><\/script>$/),
    ]);
    /** Text that only mentions the markup, or a look-alike, is not a match. */
    expect(pageWith('<p>Add data-jf-form or #jf-cart-page to a page.</p><div class="not-jf-product-x" id="jf-cart-page-2"></div>')).toEqual({ styles: [], body: [] });
  });
});
