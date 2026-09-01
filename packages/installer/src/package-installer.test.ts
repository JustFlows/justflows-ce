import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { describe, expect, it } from "vitest";
import { PackageInstaller } from "./package-installer.js";
import { PackageRejectedError } from "./archive-safety.js";

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
    expect(result.manifest.settingsSchema?.["defaultDescription"]?.label).toBe(
      "Default meta description",
    );
    await expect(
      fs.readFile(path.join(result.installedPath, "justflows.json"), "utf8"),
    ).resolves.toContain("test.plugin");
  });
});

/** Build a .jfpkg whose manifest declares the given version. */
async function packageWithVersion(
  dir: string,
  version: string,
  tag: string,
  engines?: { justflows: string },
  type: "plugin" | "theme" | "css-provider" = "plugin",
): Promise<Buffer> {
  const src = path.join(dir, "src");
  await fs.mkdir(src, { recursive: true });
  await fs.writeFile(
    path.join(src, "justflows.json"),
    JSON.stringify({
      schemaVersion: 1,
      type,
      id: type === "plugin" ? "acme.probe" : `acme.${type}`,
      name: "Test",
      version,
      publisher: "Test",
      license: "GPL-2.0-or-later",
      engines,
    }),
  );
  await fs.writeFile(path.join(src, "payload.js"), "// payload\n");
  const archive = path.join(dir, `pkg-${tag}.jfpkg`);
  await tar.c({ gzip: true, file: archive, cwd: src }, ["justflows.json", "payload.js"]);
  return fs.readFile(archive);
}

describe("PackageInstaller path containment", () => {
  it("cannot delete or write outside packagesDir", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "jfpkg-escape-"));
    const packagesDir = path.join(root, "packages-installed");
    const victim = path.join(root, "victim");
    await fs.mkdir(victim, { recursive: true });
    await fs.writeFile(path.join(victim, "server.js"), "ORIGINAL SERVER CODE");

    // packages-installed/plugins/acme.evil/<version> is four levels below the
    // temp root, so four "../" steps land on <root>/victim — outside packagesDir.
    const buf = await packageWithVersion(root, "1.0.0/../../../../victim", "traversal");

    await expect(new PackageInstaller().installFromBuffer(buf, { packagesDir })).rejects.toThrow();

    // The victim directory and its contents must be untouched.
    await expect(fs.readFile(path.join(victim, "server.js"), "utf8")).resolves.toBe(
      "ORIGINAL SERVER CODE",
    );
    await expect(fs.readdir(victim)).resolves.toEqual(["server.js"]);

    // And no staging leftovers.
    const staging = path.join(packagesDir, ".staging");
    const left = await fs.readdir(staging).catch(() => []);
    expect(left).toEqual([]);
  });

  it("still installs a legitimate prerelease version", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "jfpkg-prerelease-"));
    const packagesDir = path.join(root, "packages-installed");
    const buf = await packageWithVersion(root, "0.1.3-rc", "prerelease");

    const result = await new PackageInstaller().installFromBuffer(buf, { packagesDir });

    expect(result.installedPath).toBe(path.join(packagesDir, "plugins", "acme.probe", "0.1.3-rc"));
    await expect(
      fs.readFile(path.join(result.installedPath, "justflows.json"), "utf8"),
    ).resolves.toContain("acme.probe");
  });
});

describe("PackageInstaller Justflows compatibility", () => {
  it("accepts a development host for an extension targeting the same stable release line", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "jfpkg-dev-host-"));
    const buf = await packageWithVersion(
      root,
      "1.0.0",
      "same-release-line",
      { justflows: ">=0.1.8 <0.2.0" },
    );

    await expect(
      new PackageInstaller().installFromBuffer(buf, {
        packagesDir: path.join(root, "installed"),
        justflowsVersion: "0.1.8-dev.1",
      }),
    ).resolves.toMatchObject({ manifest: { id: "acme.probe" } });
  });

  it("does not promote a development host into a newer release line", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "jfpkg-newer-line-"));
    const buf = await packageWithVersion(
      root,
      "1.0.0",
      "newer-release-line",
      { justflows: ">=0.1.9 <0.2.0" },
    );

    await expect(
      new PackageInstaller().installFromBuffer(buf, {
        packagesDir: path.join(root, "installed"),
        justflowsVersion: "0.1.8-dev.1",
      }),
    ).rejects.toThrow("requires Justflows >=0.1.9 <0.2.0");
  });

  it("enforces the same compatible range for plugins, themes, and CSS providers", async () => {
    for (const type of ["plugin", "theme", "css-provider"] as const) {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), `jfpkg-compatible-${type}-`));
      const buf = await packageWithVersion(
        root,
        "1.0.0",
        `compatible-${type}`,
        { justflows: ">=0.1.8-dev.1 <0.2.0" },
        type,
      );

      await expect(
        new PackageInstaller().installFromBuffer(buf, {
          packagesDir: path.join(root, "installed"),
          justflowsVersion: "0.1.8-dev.1",
        }),
      ).resolves.toMatchObject({
        manifest: { id: type === "plugin" ? "acme.probe" : `acme.${type}`, type },
      });
    }
  });

  it("rejects every incompatible extension type before it reaches the install directory", async () => {
    for (const type of ["plugin", "theme", "css-provider"] as const) {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), `jfpkg-incompatible-${type}-`));
      const packagesDir = path.join(root, "installed");
      const buf = await packageWithVersion(
        root,
        "1.0.0",
        `incompatible-${type}`,
        { justflows: ">=2.0.0" },
        type,
      );

      await expect(
        new PackageInstaller().installFromBuffer(buf, {
          packagesDir,
          justflowsVersion: "0.1.8-dev.1",
        }),
      ).rejects.toThrow("requires Justflows >=2.0.0");
      await expect(fs.readdir(path.join(packagesDir, ".staging"))).resolves.toEqual([]);
    }
  });
});

describe("PackageInstaller verify hook", () => {
  it("leaves nothing on disk when the trust check refuses the package", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "jfpkg-refused-"));
    const packagesDir = path.join(root, "packages-installed");
    const buf = await packageWithVersion(root, "1.0.0", "refused");

    await expect(
      new PackageInstaller().installFromBuffer(buf, {
        packagesDir,
        verify: () => {
          throw new Error("This package could not be verified.");
        },
      }),
    ).rejects.toThrow(PackageRejectedError);

    // The final install location must never have been created...
    await expect(
      fs.stat(path.join(packagesDir, "plugins", "acme.probe", "1.0.0")),
    ).rejects.toThrow();
    // ...and staging must be empty rather than holding the refused files.
    const staged = await fs.readdir(path.join(packagesDir, ".staging")).catch(() => []);
    expect(staged).toEqual([]);
  });

  it("surfaces the refusal message so the route can pass it on", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "jfpkg-msg-"));
    const buf = await packageWithVersion(root, "1.0.0", "msg");

    await expect(
      new PackageInstaller().installFromBuffer(buf, {
        packagesDir: path.join(root, "packages-installed"),
        verify: () => {
          throw new Error("manifest.type must be 'theme'");
        },
      }),
    ).rejects.toThrow("manifest.type must be 'theme'");
  });

  it("installs normally when the trust check passes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "jfpkg-ok-"));
    const packagesDir = path.join(root, "packages-installed");
    const buf = await packageWithVersion(root, "1.0.0", "ok");
    const seen: string[] = [];

    const result = await new PackageInstaller().installFromBuffer(buf, {
      packagesDir,
      verify: (manifest, digest) => {
        seen.push(manifest.id, digest.slice(0, 8));
      },
    });

    expect(seen[0]).toBe("acme.probe");
    expect(result.installedPath).toBe(path.join(packagesDir, "plugins", "acme.probe", "1.0.0"));
  });
});
