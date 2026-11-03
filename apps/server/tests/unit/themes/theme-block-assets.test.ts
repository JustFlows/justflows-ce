// SPDX-License-Identifier: MIT

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { markBlockTypes, withBlockChrome } from "@justflows/blocks";
import { pageAssetTags } from "../../../src/lib/rendering/block-assets.js";
import { readThemeBlockAssets, themeAssetHref } from "../../../src/lib/themes/theme-block-assets.js";

describe("theme per-block assets", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "jf-theme-blocks-"));
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(path.join(dir, "assets", "lightbox.js"), "window.__lightbox = 1;");
    writeFileSync(path.join(dir, "assets", "gallery.css"), ".gallery{}");
    writeFileSync(path.join(dir, "assets", "big.js"), "x".repeat(600 * 1024));
    writeFileSync(path.join(tmpdir(), "jf-outside.js"), "secret");
    symlinkSync(path.join(tmpdir(), "jf-outside.js"), path.join(dir, "assets", "link.js"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps any block type with safe, existing, regular files and versions them", () => {
    const assets = readThemeBlockAssets(dir, {
      "core.gallery": { scripts: ["assets/lightbox.js", "assets/missing.js", "assets/big.js", "assets/link.js"], styles: ["assets/gallery.css"] },
      "acme.shop.product": { scripts: ["assets/lightbox.js", "../escape.js"] },
      "bad type-->": { scripts: ["assets/lightbox.js"] },
      "core.video": { scripts: ["assets/missing.js"] },
    });
    expect(assets.blocks).toEqual([
      { type: "core.gallery", scripts: ["assets/lightbox.js"], styles: ["assets/gallery.css"] },
      { type: "acme.shop.product", scripts: ["assets/lightbox.js"], styles: [] },
    ]);
    expect(themeAssetHref(assets, "assets/lightbox.js")).toMatch(/^\/theme-assets\/assets\/lightbox\.js\?v=[0-9a-f]{12}$/);
  });

  it("links a core block's assets only on pages that render it, once marked", () => {
    const assets = readThemeBlockAssets(dir, {
      "core.gallery": { scripts: ["assets/lightbox.js"], styles: ["assets/gallery.css"] },
      "acme.shop.product": { scripts: ["assets/lightbox.js"] },
    });
    markBlockTypes(assets.blocks.map((block) => block.type));
    const entries = assets.blocks.map((block) => ({ ...block, href: (rel: string) => themeAssetHref(assets, rel) }));
    const page = `<main>${withBlockChrome("<figure>g</figure>", { type: "core.gallery", props: {} })}${withBlockChrome("<div>p</div>", { type: "acme.shop.product", props: {} })}</main>`;
    const tags = pageAssetTags(entries, page);
    expect(tags.styles).toHaveLength(1);
    /** Shared by both blocks, linked once. */
    expect(tags.body).toHaveLength(1);
    expect(pageAssetTags(entries, "<main><p>plain</p></main>")).toEqual({ styles: [], body: [] });
  });
});
