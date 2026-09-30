// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readPluginTemplate, templatesDirName } from "../../../src/lib/plugins/plugin-templates.js";

describe("templatesDirName", () => {
  it("defaults to templates and accepts a relative folder", () => {
    expect(templatesDirName({})).toBe("templates");
    expect(templatesDirName({ dir: "dist/templates" })).toBe("dist/templates");
  });

  it("rejects a missing declaration, traversal, and absolute paths", () => {
    expect(templatesDirName(undefined)).toBeNull();
    expect(templatesDirName({ dir: "../templates" })).toBeNull();
    expect(templatesDirName({ dir: "/etc" })).toBeNull();
  });
});

describe("readPluginTemplate", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "jf-plugin-templates-"));
    writeFileSync(
      path.join(dir, "single-product.json"),
      JSON.stringify({ blocks: [{ id: "a", type: "core.post-content", version: 1, props: {} }] }),
    );
    writeFileSync(path.join(dir, "empty.json"), JSON.stringify({ blocks: [] }));
    writeFileSync(path.join(dir, "broken.json"), "{");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("returns the blocks of a shipped template", () => {
    expect(readPluginTemplate(dir, "single-product")?.[0]?.type).toBe("core.post-content");
  });

  it("returns null for missing, empty, broken, or unsafe slugs", () => {
    expect(readPluginTemplate(dir, "single-post")).toBeNull();
    expect(readPluginTemplate(dir, "empty")).toBeNull();
    expect(readPluginTemplate(dir, "broken")).toBeNull();
    expect(readPluginTemplate(dir, "../single-product")).toBeNull();
  });
});
