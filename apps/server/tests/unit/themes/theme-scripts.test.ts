// SPDX-License-Identifier: MIT
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadThemeScripts, loadThemeMediaOrigins } from "../../../src/lib/themes/theme-files.js";

let root: string;
let previous: string | undefined;
let dir: string;
beforeEach(() => {
  previous = process.env.JF_ROOT;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "jf-theme-scripts-"));
  process.env.JF_ROOT = root;
  dir = path.join(root, "themes", "voyage"); fs.mkdirSync(dir, { recursive: true });
});
afterEach(() => {
  if (previous === undefined) delete process.env.JF_ROOT; else process.env.JF_ROOT = previous;
  fs.rmSync(root, { recursive: true, force: true });
});
function manifest(scripts: unknown) { fs.writeFileSync(path.join(dir, "justflows-theme.json"), JSON.stringify({ scripts })); }

describe("active theme scripts", () => {
  it("loads declared scripts in order, including installed theme packages", () => {
    manifest(["one.js", "two.mjs"]);
    fs.writeFileSync(path.join(dir, "one.js"), "window.one = true;");
    fs.writeFileSync(path.join(dir, "two.mjs"), "window.two = true;");
    expect(loadThemeScripts("justflows.voyage")).toBe("window.one = true;\n;\nwindow.two = true;");
    const installed = path.join(root, "packages-installed", "themes", "voyage", "1.0.0");
    fs.mkdirSync(installed, { recursive: true }); fs.cpSync(dir, installed, { recursive: true });
    expect(loadThemeScripts("justflows.voyage", installed)).toContain("window.two");
  });
  it("rejects traversal, arbitrary extensions, remote scripts, and symlink escapes", () => {
    fs.writeFileSync(path.join(root, "secret.js"), "secret");
    fs.symlinkSync(path.join(root, "secret.js"), path.join(dir, "escape.js"));
    manifest(["../../secret.js", path.join(root, "secret.js"), "escape.js", "https://evil.test/remote.js", "env.txt"]);
    expect(loadThemeScripts("justflows.voyage")).toBe("");
    expect(loadThemeScripts("../../secret")).toBe("");
  });
  it("bounds script counts and sizes and tolerates missing files", () => {
    manifest(["large.js", "missing.js", "small.js"]);
    fs.writeFileSync(path.join(dir, "large.js"), "x".repeat(512 * 1024 + 1));
    fs.writeFileSync(path.join(dir, "small.js"), "ok;");
    expect(loadThemeScripts("justflows.voyage")).toBe("ok;");
    manifest(Array(21).fill("small.js")); expect(loadThemeScripts("justflows.voyage")).toBe("");
    manifest(null); expect(loadThemeScripts("justflows.voyage")).toBe("");
  });
});

it("validates declared media origins without accepting schemes, credentials, paths or wildcards", () => {
  fs.writeFileSync(path.join(dir, "justflows-theme.json"), JSON.stringify({ mediaOrigins: ["https://cdn.test", "https://cdn.test", "http://cdn.test", "https://cdn.test/path", "https://u:p@cdn.test", "*"] }));
  expect(loadThemeMediaOrigins("justflows.voyage")).toEqual(["https://cdn.test"]);
});
