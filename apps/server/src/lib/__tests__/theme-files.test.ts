import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listThemePatterns, loadThemeDemoHome, resolveThemeDir } from "../theme-files.js";

let root: string;
let previousRoot: string | undefined;
let previousPackages: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "jf-themes-"));
  previousRoot = process.env.JF_ROOT;
  previousPackages = process.env.PACKAGES_DIR;
  process.env.JF_ROOT = root;
  process.env.PACKAGES_DIR = path.join(root, "packages-installed");

  const bundled = path.join(root, "themes", "default");
  fs.mkdirSync(path.join(bundled, "demo"), { recursive: true });
  fs.writeFileSync(path.join(bundled, "justflows-theme.json"), "{}\n");
  fs.writeFileSync(
    path.join(bundled, "demo", "home.json"),
    JSON.stringify({ blocks: [{ type: "core/paragraph", data: {} }] }),
  );
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.JF_ROOT;
  else process.env.JF_ROOT = previousRoot;
  if (previousPackages === undefined) delete process.env.PACKAGES_DIR;
  else process.env.PACKAGES_DIR = previousPackages;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("resolveThemeDir", () => {
  it("resolves the bundled default theme", () => {
    expect(resolveThemeDir("justflows.default")).toBe(path.join(root, "themes", "default"));
  });

  it("rejects a theme id that would traverse out of themes/", () => {
    expect(resolveThemeDir("../etc")).toBeNull();
    expect(resolveThemeDir("..\\windows")).toBeNull();
    expect(resolveThemeDir("/etc/passwd")).toBeNull();
  });

  it("ignores an installedPath outside themes/ and packages-installed/", () => {
    const outside = path.join(root, "outside-theme");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "justflows-theme.json"), "{}\n");
    expect(resolveThemeDir("justflows.default", outside)).toBe(
      path.join(root, "themes", "default"),
    );
    expect(resolveThemeDir("justflows.default", "/etc/passwd")).toBe(
      path.join(root, "themes", "default"),
    );
  });

  it("accepts an installedPath under packages-installed/", () => {
    const installed = path.join(root, "packages-installed", "themes", "justflows.custom", "1.0.0");
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(installed, "justflows-theme.json"), "{}\n");
    expect(resolveThemeDir("justflows.custom", installed)).toBe(installed);
  });
});

describe("loadThemeDemoHome", () => {
  it("loads demo blocks for a trusted theme", () => {
    expect(loadThemeDemoHome("justflows.default")).toEqual([
      { type: "core/paragraph", data: {} },
    ]);
  });

  it("does not read files for a traversing theme id", () => {
    expect(loadThemeDemoHome("../../.env")).toBeNull();
  });
});

describe("listThemePatterns", () => {
  it("passes through requiresBlockTypes for patterns that depend on a plugin block", () => {
    const patternsDir = path.join(root, "themes", "default", "patterns");
    fs.mkdirSync(patternsDir, { recursive: true });
    fs.writeFileSync(
      path.join(patternsDir, "contact.json"),
      JSON.stringify({
        id: "contact",
        title: "Contact page",
        requiresBlockTypes: ["justflows.forms.form"],
        blocks: [],
      }),
    );
    fs.writeFileSync(
      path.join(patternsDir, "about.json"),
      JSON.stringify({ id: "about", title: "About page", blocks: [] }),
    );

    const patterns = listThemePatterns("justflows.default");
    expect(patterns.find((p) => p.id === "contact")?.requiresBlockTypes).toEqual([
      "justflows.forms.form",
    ]);
    expect(patterns.find((p) => p.id === "about")?.requiresBlockTypes).toBeUndefined();
  });
});
