import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cssProviderBuildKey,
  ensureCssProviderBuild,
  resolveInstalledAssetPath,
} from "../../../src/lib/extensions/css-provider-install.js";

let installRoot: string;
let root: string;
const KEY = "0123456789abcdef01234567";

beforeEach(() => {
  installRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jf-cssp-"));
  process.env.CSS_PROVIDERS_INSTALL_DIR = installRoot;
  root = path.join(installRoot, "builds", KEY);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, ".complete"), "");

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
  fs.rmSync(installRoot, { recursive: true, force: true });
});

describe("resolveInstalledAssetPath", () => {
  it("serves stylesheets from node_modules", () => {
    expect(resolveInstalledAssetPath(`${KEY}/tailwindcss/tailwind.css`)).toBe(
      path.join(root, "node_modules", "tailwindcss", "tailwind.css"),
    );
  });

  it("serves generated stylesheets from dist", () => {
    expect(resolveInstalledAssetPath(`${KEY}/dist/tailwind.css`)).toBe(
      path.join(root, "dist", "tailwind.css"),
    );
  });

  it("refuses input.css, which is a build input and can hold copied host files", () => {
    expect(resolveInstalledAssetPath(`${KEY}/input.css`)).toBeNull();
  });

  it("refuses package.json and other install-directory scaffolding", () => {
    expect(resolveInstalledAssetPath(`${KEY}/package.json`)).toBeNull();
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
      expect(resolveInstalledAssetPath(`${KEY}/${attempt}`)).toBeNull();
    }
  });

  it("refuses a directory even when the path resolves", () => {
    expect(resolveInstalledAssetPath(`${KEY}/tailwindcss`)).toBeNull();
  });

  it("does not escape into a sibling directory sharing the install prefix", () => {
    const sibling = path.join(installRoot, "builds", `${KEY}-evil`);
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(sibling, "secret.css"), "x{}");
    try {
      expect(resolveInstalledAssetPath(`${KEY}/../${path.basename(sibling)}/secret.css`)).toBeNull();
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });
});

describe("css provider builds", () => {
  it("only serves a build that finished", () => {
    fs.rmSync(path.join(root, ".complete"));
    expect(resolveInstalledAssetPath(`${KEY}/dist/tailwind.css`)).toBeNull();
  });

  it("gives different providers separate builds and nothing to build for None", () => {
    const tailwind = { dependencies: { tailwindcss: "^3.4.0" }, installedPath: "/p/a" };
    expect(cssProviderBuildKey(tailwind)).toMatch(/^[a-f0-9]{24}$/);
    expect(cssProviderBuildKey({ ...tailwind, installedPath: "/p/b" })).not.toBe(cssProviderBuildKey(tailwind));
    expect(cssProviderBuildKey({ id: "justflows.none", stylesheets: [] })).toBeNull();
  });

  it("does not touch existing builds when a site switches to None", async () => {
    await expect(ensureCssProviderBuild({ id: "justflows.none" })).resolves.toBeNull();
    expect(resolveInstalledAssetPath(`${KEY}/dist/tailwind.css`)).toBe(path.join(root, "dist", "tailwind.css"));
  });
});
