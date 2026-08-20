import type { StorageAdapter } from "./storage-adapter.js";

export interface S3AdapterOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Public CDN base URL (optional — falls back to s3 endpoint) */
  cdnBaseUrl?: string;
}

/**
 * S3-compatible storage adapter (Cloudflare R2, MinIO, AWS S3).
 * Uses the native fetch-based S3 API — no AWS SDK required.
 */
export class S3StorageAdapter implements StorageAdapter {
  private readonly baseEndpoint: string;

  constructor(private readonly opts: S3AdapterOptions) {
    this.baseEndpoint = opts.endpoint
      ? opts.endpoint.replace(/\/$/, "")
      : `https://s3.${opts.region}.amazonaws.com`;
  }

  async save(key: string, data: Buffer, mimeType: string): Promise<string> {
    const url = `${this.baseEndpoint}/${this.opts.bucket}/${key}`;
    const headers = await this.signedHeaders("PUT", key, mimeType, data);

    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": mimeType, ...headers },
      body: data,
    });

    if (!res.ok) {
      throw new Error(`S3 PUT failed: ${res.status} ${res.statusText}`);
    }

    return this.url(key);
  }

  async delete(key: string): Promise<void> {
    const url = `${this.baseEndpoint}/${this.opts.bucket}/${key}`;
    const headers = await this.signedHeaders("DELETE", key);

    const res = await fetch(url, { method: "DELETE", headers });
    if (!res.ok && res.status !== 404) {
      throw new Error(`S3 DELETE failed: ${res.status}`);
    }
  }

  url(key: string): string {
    if (this.opts.cdnBaseUrl) {
      return `${this.opts.cdnBaseUrl.replace(/\/$/, "")}/${key}`;
    }
    return `${this.baseEndpoint}/${this.opts.bucket}/${key}`;
  }

  private async signedHeaders(
    _method: string,
    _key: string,
    _contentType?: string,
    _body?: Buffer,
  ): Promise<Record<string, string>> {
    // Full AWS Signature V4 signing will be implemented when S3 integration
    // is activated. For now returns basic auth headers for MinIO-compatible servers.
    const auth = Buffer.from(`${this.opts.accessKeyId}:${this.opts.secretAccessKey}`).toString(
      "base64",
    );
    return { Authorization: `Basic ${auth}` };
  }
}
