import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilesystemCache } from "../filesystem.js";

let dir: string;
let cache: FilesystemCache;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "jf-cache-"));
  cache = new FilesystemCache(dir, 300);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("FilesystemCache key isolation", () => {
  it("keeps punctuation variants of a path apart", async () => {
    await cache.set("page:html:/foo-bar", "DASH");
    await cache.set("page:html:/foo.bar", "DOT");
    await cache.set("page:html:/foo/bar", "SLASH");
    await cache.set("page:html:/foo_bar", "UNDERSCORE");

    expect(await cache.get("page:html:/foo-bar")).toBe("DASH");
    expect(await cache.get("page:html:/foo.bar")).toBe("DOT");
    expect(await cache.get("page:html:/foo/bar")).toBe("SLASH");
    expect(await cache.get("page:html:/foo_bar")).toBe("UNDERSCORE");
    expect(fs.readdirSync(dir)).toHaveLength(4);
  });

  it("keeps a long path apart from its :404 variant", async () => {
    const long = "/" + "a".repeat(240);
    await cache.set(`page:html:${long}`, "PAGE");
    await cache.set(`page:html:${long}:404`, "NOT_FOUND");

    expect(await cache.get(`page:html:${long}`)).toBe("PAGE");
    expect(await cache.get(`page:html:${long}:404`)).toBe("NOT_FOUND");
  });

  it("still invalidates a whole namespace by prefix", async () => {
    await cache.set("page:html:/a", 1);
    await cache.set("page:html:/b", 2);
    await cache.set("menus:primary", 3);

    await cache.invalidate("page:html:");

    expect(await cache.get("page:html:/a")).toBeUndefined();
    expect(await cache.get("page:html:/b")).toBeUndefined();
    expect(await cache.get("menus:primary")).toBe(3);
  });

  it("round-trips keys with characters that are illegal in filenames", async () => {
    for (const key of ["page:html:/ünïcodé", "page:html:/a b c", "page:html:/../../etc/passwd"]) {
      await cache.set(key, key);
      expect(await cache.get(key)).toBe(key);
    }
    // Nothing escaped the cache directory.
    expect(fs.readdirSync(dir).every((n) => n.endsWith(".json"))).toBe(true);
    expect(fs.readdirSync(dir).every((n) => /^[a-f0-9]{64}\.json$/.test(n))).toBe(true);
  });

  it("ignores directory entries that are not contained cache files", async () => {
    fs.writeFileSync(path.join(dir, "broken.json"), "not json");
    fs.mkdirSync(path.join(dir, "nested"));
    await cache.set("page:html:/safe", "SAFE");
    await cache.invalidate("page:html:");
    expect(await cache.get("page:html:/safe")).toBeUndefined();
    expect(fs.existsSync(path.join(dir, "broken.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "nested"))).toBe(true);
  });
});
