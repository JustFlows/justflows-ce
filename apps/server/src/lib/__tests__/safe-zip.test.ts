// SPDX-License-Identifier: MIT

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractZipSafely, ZipSafetyError } from "../safe-zip.js";

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

describe("extractZipSafely", () => {
  it("extracts a nested file after listing entries", () => {
    const src = tmpDir();
    const dest = tmpDir();
    fs.mkdirSync(path.join(src, "nested"));
    fs.writeFileSync(path.join(src, "nested", "hello.txt"), "ok");

    const zipPath = path.join(tmpDir(), "pkg.zip");
    const zipped = spawnSync("zip", ["-r", zipPath, "nested"], { cwd: src, encoding: "utf-8" });
    expect(zipped.status).toBe(0);

    extractZipSafely(zipPath, dest);
    expect(fs.readFileSync(path.join(dest, "nested", "hello.txt"), "utf-8")).toBe("ok");
  });

  it("rejects path-traversal entries", () => {
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

    expect(() => extractZipSafely(zipPath, dest)).toThrow(ZipSafetyError);
    expect(fs.existsSync(path.join(dest, "..", "outside.txt"))).toBe(false);
  });
});
