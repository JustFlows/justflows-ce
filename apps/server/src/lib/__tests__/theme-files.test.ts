import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listThemePatterns,
  listThemeTemplateSlugs,
  loadThemeDemoHome,
  loadThemeTemplate,
  loadThemeTemplatePart,
  resolveThemeDir,
  resolveThemeTemplate,
} from "../theme-files.js";
import { templateCandidates } from "../template-hierarchy.js";

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
    expect(loadThemeDemoHome("justflows.default")).toEqual([{ type: "core/paragraph", data: {} }]);
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
        blocks: [{ id: "form", type: "justflows.forms.form", version: 1, props: {} }],
      }),
    );
    fs.writeFileSync(
      path.join(patternsDir, "about.json"),
      JSON.stringify({
        id: "about",
        title: "About page",
        blocks: [{ id: "copy", type: "core.paragraph", version: 1, props: {} }],
      }),
    );

    const patterns = listThemePatterns("justflows.default");
    expect(patterns.find((p) => p.id === "contact")?.requiresBlockTypes).toEqual([
      "justflows.forms.form",
    ]);
    expect(patterns.find((p) => p.id === "about")?.requiresBlockTypes).toBeUndefined();
  });
});

describe("template hierarchy files", () => {
  function writeTemplate(slug: string, blocks: unknown[]): void {
    const dir = path.join(root, "themes", "default", "templates");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify({ blocks }));
  }

  it("loads a templates/<slug>.json block document", () => {
    writeTemplate("single", [{ type: "core.post-content", props: {} }]);
    expect(loadThemeTemplate("justflows.default", "single")).toEqual([
      { type: "core.post-content", props: {} },
    ]);
  });

  it("rejects an unsafe slug without touching the filesystem", () => {
    expect(loadThemeTemplate("justflows.default", "../../etc/passwd")).toBeNull();
    expect(loadThemeTemplate("../../.env", "single")).toBeNull();
  });

  it("falls back to demo/home.json for the front-page slot", () => {
    // beforeEach wrote demo/home.json; no templates/front-page.json exists.
    expect(loadThemeTemplate("justflows.default", "front-page")).toEqual([
      { type: "core/paragraph", data: {} },
    ]);
  });

  it("resolveThemeTemplate walks candidates and reports the slug that matched", () => {
    writeTemplate("single-post", [{ type: "core.heading", props: { text: "Post" } }]);
    const candidates = templateCandidates({
      kind: "singular",
      contentType: "post",
      slug: "hello-world",
    });
    expect(resolveThemeTemplate("justflows.default", candidates)).toEqual({
      slug: "single-post",
      blocks: [{ type: "core.heading", props: { text: "Post" } }],
    });
  });

  it("resolveThemeTemplate returns null when the theme ships no matching file", () => {
    const candidates = templateCandidates({ kind: "notFound" });
    expect(resolveThemeTemplate("justflows.default", candidates)).toBeNull();
  });

  it("listThemeTemplateSlugs enumerates only valid template files", () => {
    writeTemplate("single", []);
    writeTemplate("404", []);
    fs.writeFileSync(path.join(root, "themes", "default", "templates", "notes.txt"), "ignore me");
    expect(listThemeTemplateSlugs("justflows.default")).toEqual(["404", "single"]);
  });

  it("loadThemeTemplatePart reads parts/<slug>.json and falls back to demo/footer.json", () => {
    const partsDir = path.join(root, "themes", "default", "parts");
    fs.mkdirSync(partsDir, { recursive: true });
    fs.writeFileSync(
      path.join(partsDir, "header.json"),
      JSON.stringify({ blocks: [{ type: "core.html", props: { html: "<nav></nav>" } }] }),
    );
    expect(loadThemeTemplatePart("justflows.default", "header")).toEqual([
      { type: "core.html", props: { html: "<nav></nav>" } },
    ]);

    const demoDir = path.join(root, "themes", "default", "demo");
    fs.writeFileSync(
      path.join(demoDir, "footer.json"),
      JSON.stringify({ blocks: [{ type: "core.paragraph", props: { text: "© 2026" } }] }),
    );
    expect(loadThemeTemplatePart("justflows.default", "footer")).toEqual([
      { type: "core.paragraph", props: { text: "© 2026" } },
    ]);
  });
});
