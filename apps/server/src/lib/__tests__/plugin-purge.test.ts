// SPDX-License-Identifier: MIT

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appliedSchemaPasswordKey,
  appliedSchemaSettingKey,
  pluginSettingsLikePattern,
  purgePluginFiles,
} from "../plugin-purge.js";

describe("plugin purge keys", () => {
  it("scopes settings deletes to the plugin's colon prefix", () => {
    expect(pluginSettingsLikePattern("justflows.shop")).toBe("plugin.justflows.shop:%");
    expect(pluginSettingsLikePattern("justflows.shop")).not.toContain("justflows.shopping");
    expect(appliedSchemaSettingKey("justflows.shop")).toBe("plugin_schema:justflows.shop");
    expect(appliedSchemaPasswordKey("justflows.shop")).toBe("plugin_schema:justflows.shop:password");
  });
});

describe("purgePluginFiles", () => {
  let root: string;
  const savedPackagesDir = process.env.PACKAGES_DIR;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "jf-purge-files-"));
    process.env.PACKAGES_DIR = path.join(root, "packages-installed");
  });

  afterEach(() => {
    if (savedPackagesDir === undefined) delete process.env.PACKAGES_DIR;
    else process.env.PACKAGES_DIR = savedPackagesDir;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("deletes the installed directory and prunes now-empty parents", () => {
    const installedPath = path.join(
      root,
      "packages-installed",
      "plugins",
      "acme.demo",
      "1.0.0",
      "abcdef0123456789",
    );
    fs.mkdirSync(installedPath, { recursive: true });
    fs.writeFileSync(path.join(installedPath, "justflows.json"), "{}");

    const result = purgePluginFiles({ installedPath });

    expect(result.ok).toBe(true);
    expect(fs.existsSync(installedPath)).toBe(false);
    // `<id>` and `<id>/<version>` had nothing else in them, so they go too.
    expect(fs.existsSync(path.join(root, "packages-installed", "plugins", "acme.demo"))).toBe(false);
    expect(fs.existsSync(path.join(root, "packages-installed", "plugins"))).toBe(true);
  });

  it("keeps a parent that still holds another build", () => {
    const base = path.join(root, "packages-installed", "plugins", "acme.demo", "1.0.0");
    const gone = path.join(base, "1111111111111111");
    const kept = path.join(base, "2222222222222222");
    fs.mkdirSync(gone, { recursive: true });
    fs.mkdirSync(kept, { recursive: true });

    expect(purgePluginFiles({ installedPath: gone }).ok).toBe(true);

    expect(fs.existsSync(gone)).toBe(false);
    expect(fs.existsSync(kept)).toBe(true);
  });

  it("refuses to touch a path outside packages-installed", () => {
    const outside = path.join(root, "not-packages", "payload");
    fs.mkdirSync(outside, { recursive: true });

    const result = purgePluginFiles({ installedPath: outside });

    expect(result.ok).toBe(true);
    expect(fs.existsSync(outside)).toBe(true);
  });

  it("is a no-op for a bundled plugin with no installedPath", () => {
    expect(purgePluginFiles({ bundledPath: "/somewhere/plugins/acme.demo" }).ok).toBe(true);
    expect(purgePluginFiles(undefined).ok).toBe(true);
  });
});
