import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { CacheAdapter } from "./adapter.js";

function cacheFileName(key: string): string {
  return `${createHash("sha256").update(key).digest("hex")}.json`;
}

function resolvePathUnderBase(base: string, name: string): string | null {
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(resolvedBase, name);
  return path.dirname(resolved) === resolvedBase ? resolved : null;
}

interface Entry<T> {
  key: string;
  value: T;
  expiresAt: number | null;
}

export class FilesystemCache implements CacheAdapter {
  constructor(
    private readonly dir: string,
    private readonly defaultTtlSeconds = 300,
  ) {}

  /**
   * Filenames contain only a SHA-256 digest. The original key is stored inside
   * the entry for namespace invalidation, so uncontrolled keys never become a
   * filesystem path component.
   */
  private filePath(key: string): string {
    const resolved = resolvePathUnderBase(this.dir, cacheFileName(key));
    if (!resolved) throw new Error("Invalid cache path");
    return resolved;
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
      key,
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
      for (const name of entries) {
        const file = resolvePathUnderBase(this.dir, name);
        if (!file || !name.endsWith(".json")) continue;
        const raw = await fs.readFile(file, "utf-8").catch(() => "");
        if (!raw) continue;
        let entry: Partial<Entry<unknown>>;
        try {
          entry = JSON.parse(raw) as Partial<Entry<unknown>>;
        } catch {
          continue;
        }
        if (typeof entry.key === "string" && entry.key.startsWith(prefix)) await fs.unlink(file).catch(() => null);
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
          const file = resolvePathUnderBase(this.dir, name);
          if (file) await fs.unlink(file).catch(() => null);
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
