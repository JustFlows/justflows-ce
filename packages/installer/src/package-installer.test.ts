import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { describe, expect, it } from "vitest";
import { PackageInstaller } from "./package-installer.js";

describe("PackageInstaller", () => {
  it("extracts justflows.json from a gzipped tar buffer", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jfpkg-"));
    const src = path.join(dir, "src");
    await fs.mkdir(src);
    await fs.writeFile(
      path.join(src, "justflows.json"),
      JSON.stringify({
        schemaVersion: 1,
        type: "plugin",
        id: "test.plugin",
        name: "Test",
        version: "1.0.0",
        publisher: "Test",
        license: "GPL-2.0-or-later",
        settingsSchema: {
          defaultDescription: { type: "text", label: "Default meta description", default: "" },
        },
      }),
    );
    const archive = path.join(dir, "pkg.jfpkg");
    await tar.c({ gzip: true, file: archive, cwd: src }, ["justflows.json"]);
    const buf = await fs.readFile(archive);

    const installer = new PackageInstaller();
    const result = await installer.installFromBuffer(buf, {
      packagesDir: path.join(dir, "installed"),
    });

    expect(result.manifest.id).toBe("test.plugin");
    expect(result.manifest.settingsSchema?.["defaultDescription"]?.label).toBe("Default meta description");
    await expect(fs.readFile(path.join(result.installedPath, "justflows.json"), "utf8")).resolves.toContain(
      "test.plugin",
    );
  });
});
