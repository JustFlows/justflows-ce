// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assetTags, buildBundle, safeAssetRel } from "../plugin-assets.js";

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

describe("assetTags", () => {
  it("renders deferred script and stylesheet tags under /ext/<pluginId>/", () => {
    const html = assetTags("acme.widget", {
      scripts: ["widget.js", "extra/init.js"],
      styles: ["widget.css"],
    });
    expect(html).toContain('<link rel="stylesheet" href="/ext/acme.widget/widget.css">');
    expect(html).toContain('<script src="/ext/acme.widget/widget.js" defer></script>');
    expect(html).toContain('<script src="/ext/acme.widget/extra/init.js" defer></script>');
  });

  it("drops unsafe entries and rejects a bad plugin id", () => {
    expect(assetTags("acme.widget", { scripts: ["../x.js", "ok.js"] })).toBe(
      '<script src="/ext/acme.widget/ok.js" defer></script>',
    );
    expect(assetTags("Not A Plugin Id", { scripts: ["ok.js"] })).toBe("");
  });

  it("returns an empty string when nothing is declared", () => {
    expect(assetTags("acme.widget", {})).toBe("");
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
        { pluginId: "acme.one", baseDir: dir, scripts: ["a.js"], styles: [] },
        { pluginId: "acme.two", baseDir: dir, scripts: ["b.js"], styles: [] },
      ],
      "js",
    )!;
    expect(bundle.code).toContain("/* acme.one/a.js */");
    expect(bundle.code).toContain("/* acme.two/b.js */");
    expect(bundle.code).toContain("(function(){\nwindow.__a = 1\n})();");
    expect(bundle.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(bundle.contentType).toContain("javascript");
  });

  it("is deterministic and changes with content", () => {
    const sets = [{ pluginId: "acme.one", baseDir: dir, scripts: ["a.js"], styles: [] }];
    const h1 = buildBundle(sets, "js")!.hash;
    const h2 = buildBundle(sets, "js")!.hash;
    expect(h1).toBe(h2);
    const h3 = buildBundle(
      [{ pluginId: "acme.one", baseDir: dir, scripts: ["a.js", "b.js"], styles: [] }],
      "js",
    )!.hash;
    expect(h3).not.toBe(h1);
  });

  it("concatenates styles without the IIFE wrapper", () => {
    const bundle = buildBundle(
      [{ pluginId: "acme.one", baseDir: dir, scripts: [], styles: ["a.css"] }],
      "css",
    )!;
    expect(bundle.code).toContain(".a{color:red}");
    expect(bundle.code).not.toContain("function()");
    expect(bundle.contentType).toContain("css");
  });

  it("returns null when there is nothing to bundle", () => {
    expect(buildBundle([], "js")).toBeNull();
    expect(
      buildBundle([{ pluginId: "acme.one", baseDir: dir, scripts: [], styles: [] }], "js"),
    ).toBeNull();
  });
});
