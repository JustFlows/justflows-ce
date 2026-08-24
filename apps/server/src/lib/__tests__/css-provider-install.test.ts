import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveInstalledAssetPath } from "../css-provider-install.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "jf-cssp-"));
  process.env.CSS_PROVIDERS_INSTALL_DIR = root;

  fs.mkdirSync(path.join(root, "node_modules", "tailwindcss"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "tailwindcss", "tailwind.css"), "a{}");
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist", "tailwind.css"), "b{}");

  // Build scaffolding that must never be served.
  fs.writeFileSync(path.join(root, "input.css"), "APP_SECRET=leaked");
  fs.writeFileSync(path.join(root, "package.json"), "{}");
});

afterEach(() => {
  delete process.env.CSS_PROVIDERS_INSTALL_DIR;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("resolveInstalledAssetPath", () => {
  it("serves stylesheets from node_modules", () => {
    expect(resolveInstalledAssetPath("tailwindcss/tailwind.css")).toBe(
      path.join(root, "node_modules", "tailwindcss", "tailwind.css"),
    );
  });

  it("serves generated stylesheets from dist", () => {
    expect(resolveInstalledAssetPath("dist/tailwind.css")).toBe(
      path.join(root, "dist", "tailwind.css"),
    );
  });

  it("refuses input.css, which is a build input and can hold copied host files", () => {
    expect(resolveInstalledAssetPath("input.css")).toBeNull();
  });

  it("refuses package.json and other install-directory scaffolding", () => {
    expect(resolveInstalledAssetPath("package.json")).toBeNull();
  });

  it("refuses traversal out of the install directory", () => {
    for (const attempt of [
      "../../.env",
      "../../../etc/passwd",
      "dist/../../.env",
      "/etc/passwd",
      "./../.env",
    ]) {
      expect(resolveInstalledAssetPath(attempt)).toBeNull();
    }
  });

  it("refuses a directory even when the path resolves", () => {
    expect(resolveInstalledAssetPath("tailwindcss")).toBeNull();
  });

  it("does not escape into a sibling directory sharing the install prefix", () => {
    const sibling = `${root}-evil`;
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(sibling, "secret.css"), "x{}");
    try {
      expect(resolveInstalledAssetPath("../" + path.basename(sibling) + "/secret.css")).toBeNull();
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });
});
