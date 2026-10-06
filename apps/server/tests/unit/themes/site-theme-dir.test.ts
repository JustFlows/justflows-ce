// SPDX-License-Identifier: MIT

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { siteThemesDir } from "../../../src/lib/extensions/packages-dir.js";
import { resolveThemeDir } from "../../../src/lib/themes/theme-files.js";

const SITE = "033fcfcc-8948-417d-928f-62f5b7954b67";
const saved = process.env.PACKAGES_DIR;
let dir = "";

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jf-packages-")));
  process.env.PACKAGES_DIR = dir;
});
afterEach(() => {
  if (saved === undefined) delete process.env.PACKAGES_DIR;
  else process.env.PACKAGES_DIR = saved;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("site theme folders", () => {
  it("keeps a site's forks under its own folder", () => {
    expect(siteThemesDir(SITE)).toBe(path.join(dir, "sites", SITE, "themes"));
    expect(siteThemesDir("../other")).toBeNull();
  });

  it("resolves a fork from its installed path, and never by id from another site's folder", () => {
    const fork = path.join(siteThemesDir(SITE)!, "local.mine");
    fs.mkdirSync(fork, { recursive: true });
    fs.writeFileSync(path.join(fork, "justflows-theme.json"), JSON.stringify({ id: "local.mine" }));

    expect(resolveThemeDir("local.mine", fork)).toBe(fork);
    // Without the row's installed path (another site), the id alone finds nothing.
    expect(resolveThemeDir("local.mine", null)).toBeNull();
  });
});
