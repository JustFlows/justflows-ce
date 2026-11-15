// SPDX-License-Identifier: MIT

import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import type { StorageAdapter, StoredObject } from "./storage-adapter.js";

export interface LocalAdapterOptions {
  /** Absolute path on disk where uploads are stored */
  rootPath: string;
  /** Public base URL that maps to rootPath */
  baseUrl: string;
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

/** Resolve an object key under the storage root, including existing symlinks. */
function resolvePathUnderBase(baseDir: string, key: string): string | null {
  if (!/^[A-Za-z0-9_./@+=,-]+$/.test(key)) return null;
  if (key.startsWith("/") || key.split("/").some((segment) => segment === "." || segment === "..")) return null;
  const base = path.resolve(baseDir);
  const candidate = path.resolve(base, key);
  if (candidate !== base && !candidate.startsWith(base + path.sep)) return null;

  let realBase = base;
  try {
    realBase = syncFs.realpathSync(base);
  } catch {
    /** The storage root may not exist before the first upload. */
  }

  try {
    let existingAncestor = candidate;
    while (!syncFs.existsSync(existingAncestor)) {
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) return null;
      existingAncestor = parent;
    }
    const realAncestor = syncFs.realpathSync(existingAncestor);
    return realAncestor === realBase || realAncestor.startsWith(realBase + path.sep) ? candidate : null;
  } catch {
    return null;
  }
}

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private readonly opts: LocalAdapterOptions) {}

  /** Absolute path for a key; refuses a key that resolves outside rootPath. */
  resolve(key: string): string {
    const target = resolvePathUnderBase(this.opts.rootPath, key);
    if (!target) throw new Error(`Storage key escapes the storage root: ${key}`);
    return target;
  }

  async save(key: string, data: Buffer, _mimeType: string): Promise<string> {
    const dest = this.resolve(key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, data);
    return this.url(key);
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  url(key: string): string {
    return `${this.opts.baseUrl.replace(/\/$/, "")}/${key}`;
  }

  async read(key: string): Promise<StoredObject | null> {
    try {
      return { body: await fs.readFile(this.resolve(key)), contentType: null };
    } catch (err) {
      if (isMissing(err) || (err as NodeJS.ErrnoException)?.code === "EISDIR") return null;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async move(from: string, to: string): Promise<boolean> {
    const source = this.resolve(from);
    const target = this.resolve(to);
    try {
      await fs.access(source);
    } catch {
      return false;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    // A directory move replaces whatever is at the target.
    await fs.rm(target, { recursive: true, force: true });
    try {
      await fs.rename(source, target);
    } catch (err) {
      if (isMissing(err)) return false;
      throw err;
    }
    return true;
  }

  async list(prefix: string): Promise<string[]> {
    const base = this.resolve(prefix);
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (isMissing(err) || (err as NodeJS.ErrnoException)?.code === "ENOTDIR") return;
        throw err;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) {
          out.push(path.relative(path.resolve(this.opts.rootPath), full).split(path.sep).join("/"));
        }
      }
    };
    await walk(base);
    return out.sort();
  }

  async deletePrefix(prefix: string): Promise<void> {
    await fs.rm(this.resolve(prefix), { recursive: true, force: true });
  }
}
