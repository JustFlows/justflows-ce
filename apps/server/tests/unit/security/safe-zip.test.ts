// SPDX-License-Identifier: MIT

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractZipSafely, readZipPackageVersion, ZipSafetyError } from "../../../src/lib/security/safe-zip.js";

const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jf-zip-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Both tests spawn zip/python3 and extraction runs external tools; on a busy CI
// runner process start-up alone can pass Vitest's 5s default.
describe("extractZipSafely", { timeout: 30_000 }, () => {
  it("extracts a nested file after listing entries", async () => {
    const src = tmpDir();
    const dest = tmpDir();
    fs.mkdirSync(path.join(src, "nested"));
    fs.writeFileSync(path.join(src, "nested", "hello.txt"), "ok");

    const zipPath = path.join(tmpDir(), "pkg.zip");
    const zipped = spawnSync("zip", ["-r", zipPath, "nested"], { cwd: src, encoding: "utf-8" });
    expect(zipped.status).toBe(0);

    const version = spawnSync("unzip", ["-v"], { encoding: "utf-8" });
    expect(`${version.stdout ?? ""}${version.stderr ?? ""}`).toMatch(/Info-ZIP|UnZip/);

    await extractZipSafely(zipPath, dest);
    expect(fs.readFileSync(path.join(dest, "nested", "hello.txt"), "utf-8")).toBe("ok");
  });

  it("rejects path-traversal entries", async () => {
    const dest = tmpDir();
    const zipPath = path.join(tmpDir(), "evil.zip");
    const script = `
import zipfile
z = zipfile.ZipFile(${JSON.stringify(zipPath)}, "w")
z.writestr("../outside.txt", "nope")
z.close()
`;
    const created = spawnSync("python3", ["-c", script], { encoding: "utf-8" });
    expect(created.status).toBe(0);

    await expect(extractZipSafely(zipPath, dest)).rejects.toBeInstanceOf(ZipSafetyError);
    expect(fs.existsSync(path.join(dest, "..", "outside.txt"))).toBe(false);
  });

  it("rejects a duplicate name and a symlink before writing them", async () => {
    const dest = tmpDir();
    const zipPath = path.join(tmpDir(), "dup.zip");
    const script = `
import zipfile, stat
z = zipfile.ZipFile(${JSON.stringify(zipPath)}, "w")
z.writestr("a.txt", "one")
z.writestr("a.txt", "two")
info = zipfile.ZipInfo("link.txt")
info.create_system = 3
info.external_attr = (stat.S_IFLNK | 0o777) << 16
z.writestr(info, "target")
z.close()
`;
    expect(spawnSync("python3", ["-c", script], { encoding: "utf-8" }).status).toBe(0);
    await expect(extractZipSafely(zipPath, dest)).rejects.toBeInstanceOf(ZipSafetyError);
    expect(fs.existsSync(path.join(dest, "a.txt"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "link.txt"))).toBe(false);
  });

  it("rejects a file that is also a directory prefix", async () => {
    const dest = tmpDir();
    const zipPath = path.join(tmpDir(), "both.zip");
    const script = `
import zipfile
z = zipfile.ZipFile(${JSON.stringify(zipPath)}, "w")
z.writestr("foo", "file")
z.writestr("foo/bar.txt", "child")
z.close()
`;
    expect(spawnSync("python3", ["-c", script], { encoding: "utf-8" }).status).toBe(0);
    await expect(extractZipSafely(zipPath, dest)).rejects.toBeInstanceOf(ZipSafetyError);
    expect(fs.existsSync(path.join(dest, "foo"))).toBe(false);
  });

  it("reads the core version without unpacking the archive", async () => {
    const src = tmpDir();
    fs.writeFileSync(path.join(src, "package.json"), JSON.stringify({ name: "justflows", version: "0.4.0" }));
    fs.writeFileSync(path.join(src, "server.js"), "");
    const zipPath = path.join(tmpDir(), "core.zip");
    expect(spawnSync("zip", ["-q", zipPath, "package.json", "server.js"], { cwd: src, encoding: "utf-8" }).status).toBe(0);
    await expect(readZipPackageVersion(zipPath)).resolves.toBe("0.4.0");
    expect(fs.readdirSync(path.dirname(zipPath)).some((name) => name !== "core.zip")).toBe(false);
  });
});
