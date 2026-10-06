// SPDX-License-Identifier: MIT

import fs from "node:fs/promises";
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

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private readonly opts: LocalAdapterOptions) {}

  /** Absolute path for a key; refuses a key that resolves outside rootPath. */
  resolve(key: string): string {
    const root = path.resolve(this.opts.rootPath);
    const target = path.resolve(root, key);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Storage key escapes the storage root: ${key}`);
    }
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
