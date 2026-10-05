// SPDX-License-Identifier: MIT

/** One stored object, as returned by {@link StorageAdapter.read}. */
export interface StoredObject {
  body: Buffer;
  contentType: string | null;
}

export interface StorageAdapter {
  /** Save a file, return its public URL */
  save(key: string, data: Buffer, mimeType: string): Promise<string>;
  /** Delete a file by key. A missing file is not an error. */
  delete(key: string): Promise<void>;
  /** Return a signed or public URL */
  url(key: string): string;
  /** Read a file, or null when it does not exist. */
  read(key: string): Promise<StoredObject | null>;
  /** Whether a file exists. */
  exists(key: string): Promise<boolean>;
  /** Move a file. Returns false when the source does not exist. */
  move(from: string, to: string): Promise<boolean>;
  /** Keys under a prefix (a "folder" ending in "/"), recursively. */
  list(prefix: string): Promise<string[]>;
  /** Delete every file under a prefix. */
  deletePrefix(prefix: string): Promise<void>;
}
