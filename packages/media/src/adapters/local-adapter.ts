import fs from "node:fs/promises";
import path from "node:path";
import type { StorageAdapter } from "./storage-adapter.js";

export interface LocalAdapterOptions {
  /** Absolute path on disk where uploads are stored */
  rootPath: string;
  /** Public base URL that maps to rootPath */
  baseUrl: string;
}

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private readonly opts: LocalAdapterOptions) {}

  async save(key: string, data: Buffer, _mimeType: string): Promise<string> {
    const dest = path.join(this.opts.rootPath, key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, data);
    return this.url(key);
  }

  async delete(key: string): Promise<void> {
    const target = path.join(this.opts.rootPath, key);
    await fs.rm(target, { force: true });
  }

  url(key: string): string {
    return `${this.opts.baseUrl.replace(/\/$/, "")}/${key}`;
  }
}
