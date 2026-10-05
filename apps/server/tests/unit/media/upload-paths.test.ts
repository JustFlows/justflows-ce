// SPDX-License-Identifier: MIT

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { moveMediaStorage } from "../../../src/lib/content/trash.js";
import {
  liveUploadKey,
  trashedUploadKey,
  trashedUploadKeyCandidates,
  variantPrefix,
} from "../../../src/lib/media/upload-paths.js";

const SITE = "033fcfcc-8948-417d-928f-62f5b7954b67";
const KEY = `${SITE}/photo.jpg`;
const saved = { ...process.env };
let dir = "";

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "jf-uploads-")));
  process.env.STORAGE_LOCAL_PATH = dir;
  delete process.env.STORAGE_DRIVER;
});
afterEach(async () => {
  process.env = { ...saved };
  await fs.rm(dir, { recursive: true, force: true });
});

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

describe("upload keys", () => {
  it("keeps a site's trash inside its own folder", () => {
    expect(trashedUploadKey(KEY)).toBe(`${SITE}/.trash/photo.jpg`);
    expect(variantPrefix(SITE, "m1", true)).toBe(`${SITE}/.trash/m1/`);
  });

  it("still finds items in the legacy shared trash", () => {
    expect(trashedUploadKeyCandidates(KEY)).toEqual([`${SITE}/.trash/photo.jpg`, `.trash/${KEY}`]);
  });

  it("rejects a key that escapes the uploads folder", () => {
    expect(liveUploadKey("../outside.jpg")).toBeNull();
    expect(liveUploadKey("/abs.jpg")).toBeNull();
    expect(trashedUploadKey("../x/outside.jpg")).toBeNull();
  });
});

describe("moveMediaStorage (local driver)", () => {
  it("trashes into and restores from the site's own folder", async () => {
    await fs.mkdir(path.join(dir, SITE), { recursive: true });
    await fs.writeFile(path.join(dir, KEY), "x");

    await moveMediaStorage(KEY, true);
    expect(await exists(path.join(dir, SITE, ".trash", "photo.jpg"))).toBe(true);
    expect(await exists(path.join(dir, ".trash"))).toBe(false);

    await moveMediaStorage(KEY, false);
    expect(await exists(path.join(dir, KEY))).toBe(true);
  });

  it("restores an item trashed under the legacy shared layout", async () => {
    const legacy = path.join(dir, ".trash", SITE, "photo.jpg");
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(legacy, "x");

    await moveMediaStorage(KEY, false);
    expect(await exists(path.join(dir, KEY))).toBe(true);
    expect(await exists(legacy)).toBe(false);
  });
});
