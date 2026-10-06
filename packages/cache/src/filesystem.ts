import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { CacheAdapter } from "./adapter.js";
import { cacheKeyMatchesPrefix, isSiteShardName, siteShard } from "./site-key.js";

// This derives a cache filename from an arbitrary cache key (CodeQL's taint
// tracker flags it because some callers build that key from an object with a
// password-reset *setting*, e.g. `passwordResetEnabled`/`passwordResetRoles`
// — feature flags, never a password value). SHA-256 is the right tool here:
// fast, deterministic, collision-resistant filenames. Slow-hashing it would
// only make every cache read/write pay a multi-hundred-millisecond tax — it
// is not a credential hash.
function cacheFileName(key: string): string {
  // codeql[js/insufficient-password-hash]: see comment above — not a credential hash.
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
    const shard = siteShard(key);
    const dir = shard ? path.join(this.dir, shard) : this.dir;
    const resolved = resolvePathUnderBase(dir, cacheFileName(key));
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
    await fs.mkdir(path.dirname(this.filePath(key)), { recursive: true });
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
    const shard = siteShard(prefix);
    if (shard) {
      await this.invalidateDir(path.join(this.dir, shard), prefix);
      return;
    }
    await this.invalidateDir(this.dir, prefix);
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = await fs.readdir(this.dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && isSiteShardName(entry.name)) {
        await this.invalidateDir(path.join(this.dir, entry.name), prefix);
      }
    }
  }

  private async invalidateDir(dir: string, prefix: string): Promise<void> {
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const file = resolvePathUnderBase(dir, name);
      if (!file || !name.endsWith(".json")) continue;
      const raw = await fs.readFile(file, "utf-8").catch(() => "");
      if (!raw) continue;
      let entry: Partial<Entry<unknown>>;
      try {
        entry = JSON.parse(raw) as Partial<Entry<unknown>>;
      } catch {
        continue;
      }
      if (typeof entry.key === "string" && cacheKeyMatchesPrefix(entry.key, prefix)) {
        await fs.unlink(file).catch(() => null);
      }
    }
  }

  async clear(): Promise<void> {
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = await fs.readdir(this.dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        const file = resolvePathUnderBase(this.dir, entry.name);
        if (file) await fs.unlink(file).catch(() => null);
      } else if (entry.isDirectory() && isSiteShardName(entry.name)) {
        await fs.rm(path.join(this.dir, entry.name), { recursive: true, force: true }).catch(() => null);
      }
    }
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }
}
