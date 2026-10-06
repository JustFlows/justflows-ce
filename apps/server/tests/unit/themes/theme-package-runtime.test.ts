// SPDX-License-Identifier: MIT

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mergeInstalledThemeRecord } from "../../../src/lib/themes/theme-files.js";
import { schemaWithThemeControls } from "../../../src/lib/themes/theme-customize.js";

let root: string;
let previousRoot: string | undefined;
let previousPackages: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "jf-theme-pkg-"));
  previousRoot = process.env.JF_ROOT;
  previousPackages = process.env.PACKAGES_DIR;
  process.env.JF_ROOT = root;
  process.env.PACKAGES_DIR = path.join(root, "packages-installed");
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.JF_ROOT;
  else process.env.JF_ROOT = previousRoot;
  if (previousPackages === undefined) delete process.env.PACKAGES_DIR;
  else process.env.PACKAGES_DIR = previousPackages;
  fs.rmSync(root, { recursive: true, force: true });
});

function writePackage(files: Record<string, unknown>): string {
  const dir = path.join(
    root,
    "packages-installed",
    "themes",
    "justflows.theme.halden",
    "1.0.0",
  );
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(body));
  }
  return dir;
}

describe("mergeInstalledThemeRecord", () => {
  it("keeps customize and blockControls from justflows-theme.json", () => {
    const dir = writePackage({
      "justflows.json": {
        cssVariables: { "--color-primary": "#111111" },
        customize: { dropped: { label: "Install file", controls: {} } },
      },
      "justflows-theme.json": {
        customize: {
          halden: {
            label: "Halden",
            controls: {
              "--hl-hero-height": { label: "Hero height", type: "range", default: 86 },
            },
          },
        },
        blockControls: { "core.hero": ["--hl-hero-height"] },
      },
    });

    const merged = mergeInstalledThemeRecord({
      themeId: "justflows.theme.halden",
      manifest: { id: "justflows.theme.halden", installedPath: dir },
      cssVariables: {},
    });

    expect(merged.manifest.customize).toEqual({
      halden: {
        label: "Halden",
        controls: {
          "--hl-hero-height": { label: "Hero height", type: "range", default: 86 },
        },
      },
    });
    expect(merged.manifest.blockControls).toEqual({ "core.hero": ["--hl-hero-height"] });
    expect(merged.cssVariables["--color-primary"]).toBe("#111111");
    expect(schemaWithThemeControls(merged.manifest).halden?.label).toBe("Halden");
  });

  it("reads customize from justflows.json when the theme file omits it", () => {
    const dir = writePackage({
      "justflows.json": {
        customize: {
          halden: {
            label: "Halden",
            controls: {
              "--hl-hero-height": { label: "Hero height", type: "range", default: 86 },
            },
          },
        },
      },
      "justflows-theme.json": { name: "Halden" },
    });

    const merged = mergeInstalledThemeRecord({
      themeId: "justflows.theme.halden",
      manifest: { installedPath: dir },
      cssVariables: {},
    });

    expect(schemaWithThemeControls(merged.manifest).halden?.label).toBe("Halden");
  });

  it("lets a stored css variable win over the package", () => {
    const dir = writePackage({
      "justflows.json": { cssVariables: { "--color-primary": "#111111" } },
      "justflows-theme.json": {},
    });

    const merged = mergeInstalledThemeRecord({
      themeId: "justflows.theme.halden",
      manifest: { installedPath: dir },
      cssVariables: { "--color-primary": "#abcdef" },
    });

    expect(merged.cssVariables["--color-primary"]).toBe("#abcdef");
  });

  it("drops a package colour that could break out of a declaration", () => {
    const dir = writePackage({
      "justflows.json": {
        cssVariables: { "--color-primary": "red; } body { display:none" },
      },
      "justflows-theme.json": {},
    });

    const merged = mergeInstalledThemeRecord({
      themeId: "justflows.theme.halden",
      manifest: { installedPath: dir },
      cssVariables: {},
    });

    expect(merged.cssVariables["--color-primary"]).toBeUndefined();
  });

  it("reads the package on disk when the stored row has no installedPath", () => {
    writePackage({
      "justflows.json": { name: "Halden" },
      "justflows-theme.json": {
        customize: {
          halden: {
            label: "Halden",
            controls: {
              "--hl-hero-height": { label: "Hero height", type: "range", default: 86 },
            },
          },
        },
      },
    });

    const merged = mergeInstalledThemeRecord({
      themeId: "justflows.theme.halden",
      manifest: { id: "justflows.theme.halden" },
      cssVariables: {},
    });

    expect(schemaWithThemeControls(merged.manifest).halden?.label).toBe("Halden");
  });

  it("does not read a path outside the packages directory", () => {
    const merged = mergeInstalledThemeRecord({
      themeId: "justflows.theme.halden",
      manifest: { installedPath: path.join(root, "..", "outside"), customize: { keep: true } },
      cssVariables: { "--color-primary": "#ffffff" },
    });

    expect(merged.manifest.customize).toEqual({ keep: true });
    expect(merged.cssVariables).toEqual({ "--color-primary": "#ffffff" });
  });
});
