export interface StorageAdapter {
  /** Save a file, return its public URL */
  save(key: string, data: Buffer, mimeType: string): Promise<string>;
  /** Delete a file by key */
  delete(key: string): Promise<void>;
  /** Return a signed or public URL */
  url(key: string): string;
}
