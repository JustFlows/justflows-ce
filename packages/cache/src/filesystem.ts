import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { CacheAdapter } from "./adapter.js";

/** Readable, filesystem-safe stem for a key. Lossy by design — the hash disambiguates. */
function filePrefix(key: string): string {
  return key.replace(/[^a-z0-9_-]/gi, "_").slice(0, 120);
}

interface Entry<T> {
  value: T;
  expiresAt: number | null;
}

export class FilesystemCache implements CacheAdapter {
  constructor(
    private readonly dir: string,
    private readonly defaultTtlSeconds = 300,
  ) {}

  /**
   * Filenames are `<readable-prefix>-<hash>.json`.
   *
   * The prefix keeps `invalidate()` able to match by namespace and keeps the
   * directory browsable. The hash is what makes the name unique: the previous
   * scheme replaced every character outside [a-z0-9_-] with "_" and truncated at
   * 200, so "/foo-bar", "/foo.bar", and "/foo/bar" all wrote to the same file —
   * and whichever page rendered first was served for all of them until the TTL
   * expired.
   */
  private filePath(key: string): string {
    return path.join(this.dir, `${filePrefix(key)}-${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    try {
      const raw = await fs.readFile(this.filePath(key), "utf-8");
      const entry = JSON.parse(raw) as Entry<T>;
      if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
        await this.delete(key);
        return undefined;
      }
      return entry.value;
    } catch {
      return undefined;
    }
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    const entry: Entry<T> = {
      value,
      expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : null,
    };
    await fs.writeFile(this.filePath(key), JSON.stringify(entry));
  }

  async delete(key: string): Promise<void> {
    await fs.unlink(this.filePath(key)).catch(() => null);
  }

  async invalidate(prefix: string): Promise<void> {
    try {
      const entries = await fs.readdir(this.dir);
      const safe = filePrefix(prefix);
      for (const name of entries) {
        if (name.startsWith(safe)) {
          await fs.unlink(path.join(this.dir, name)).catch(() => null);
        }
      }
    } catch {
      // dir doesn't exist
    }
  }

  async clear(): Promise<void> {
    try {
      const entries = await fs.readdir(this.dir);
      for (const name of entries) {
        if (name.endsWith(".json")) {
          await fs.unlink(path.join(this.dir, name)).catch(() => null);
        }
      }
    } catch {
      // dir doesn't exist
    }
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }
}
