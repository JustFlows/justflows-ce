// SPDX-License-Identifier: MIT

import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { redirectStubHtml, writeExport } from "../write-fs.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "jf-sx-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const file = (rel: string, body: string) => ({ rel, body: Buffer.from(body, "utf8") });

describe("writeExport", () => {
  it("writes nested files", async () => {
    const report = await writeExport(
      dir,
      [file("index.html", "home"), file("about/index.html", "about")],
      new Set(["index.html", "about/index.html"]),
      false,
    );
    expect(report.written.sort()).toEqual(["about/index.html", "index.html"]);
    expect(await readFile(path.join(dir, "about/index.html"), "utf8")).toBe("about");
  });

  it("prunes files absent from keep and cleans empty dirs", async () => {
    await mkdir(path.join(dir, "old"), { recursive: true });
    await writeFile(path.join(dir, "old/index.html"), "stale");
    await writeFile(path.join(dir, "keep.txt"), "keep");

    const report = await writeExport(
      dir,
      [file("index.html", "home")],
      new Set(["index.html", "keep.txt"]),
      true,
    );
    expect(report.pruned).toContain("old/index.html");
    expect(report.pruned).not.toContain("keep.txt");
    await expect(readFile(path.join(dir, "old/index.html"))).rejects.toThrow();
    expect(await readFile(path.join(dir, "keep.txt"), "utf8")).toBe("keep");
  });

  it("skips unsafe relative paths", async () => {
    const report = await writeExport(dir, [file("../escape.html", "x")], new Set(), false);
    expect(report.skipped).toEqual(["../escape.html"]);
    expect(report.written).toEqual([]);
  });
});

describe("redirectStubHtml", () => {
  it("emits a meta-refresh to the target", () => {
    const out = redirectStubHtml("/nl-NL/over-ons").toString("utf8");
    expect(out).toContain('http-equiv="refresh"');
    expect(out).toContain("/nl-NL/over-ons");
  });
});
