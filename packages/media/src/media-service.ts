import { randomUUID } from "node:crypto";
import path from "node:path";
import type { HooksRegistry } from "@justflows/core";
import type { StorageAdapter } from "./adapters/storage-adapter.js";
import {
  extractImageMetadata,
  generateDerivatives,
  validateUpload,
  type ImageMetadata,
  type ProcessedDerivative,
} from "./derivatives/image-processor.js";

export interface MediaItem {
  id: string;
  siteId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  width?: number;
  height?: number;
  altText?: string;
  caption?: string;
  derivatives: Record<string, { url: string; width: number; height: number }>;
  uploadedAt: string;
  uploadedBy?: string;
}

export interface UploadOptions {
  siteId: string;
  filename: string;
  mimeType: string;
  data: Buffer;
  altText?: string;
  caption?: string;
  uploadedBy?: string;
  generateImageDerivatives?: boolean;
}

export class MediaService {
  private readonly items = new Map<string, MediaItem>();

  constructor(
    private readonly storage: StorageAdapter,
    private readonly hooks: HooksRegistry,
  ) {}

  async upload(opts: UploadOptions): Promise<MediaItem> {
    await this.hooks.dispatchGate(
      "media.beforeUpload",
      {
        siteId: opts.siteId,
        filename: opts.filename,
        mimeType: opts.mimeType,
        sizeBytes: opts.data.byteLength,
      },
      { siteId: opts.siteId },
    );

    validateUpload(opts.data, opts.mimeType);

    const id = randomUUID();
    const ext = path.extname(opts.filename);
    const key = `${opts.siteId}/${id}${ext}`;
    const url = await this.storage.save(key, opts.data, opts.mimeType);

    let imageMetadata: ImageMetadata | undefined;
    let derivatives: Record<string, { url: string; width: number; height: number }> = {};

    if (opts.mimeType.startsWith("image/") && opts.generateImageDerivatives !== false) {
      try {
        imageMetadata = await extractImageMetadata(opts.data);
        const processed: ProcessedDerivative[] = await generateDerivatives(opts.data);

        for (const d of processed) {
          const dKey = `${opts.siteId}/${id}/${d.name}.${d.mimeType.split("/")[1]}`;
          const dUrl = await this.storage.save(dKey, d.data, d.mimeType);
          derivatives[d.name] = { url: dUrl, width: d.width, height: d.height };
        }
      } catch {
        // Derivative generation is non-fatal
      }
    }

    const item: MediaItem = {
      id,
      siteId: opts.siteId,
      filename: opts.filename,
      mimeType: opts.mimeType,
      sizeBytes: opts.data.byteLength,
      url,
      ...(imageMetadata?.width === undefined ? {} : { width: imageMetadata.width }),
      ...(imageMetadata?.height === undefined ? {} : { height: imageMetadata.height }),
      ...(opts.altText === undefined ? {} : { altText: opts.altText }),
      ...(opts.caption === undefined ? {} : { caption: opts.caption }),
      derivatives,
      uploadedAt: new Date().toISOString(),
      ...(opts.uploadedBy === undefined ? {} : { uploadedBy: opts.uploadedBy }),
    };

    this.items.set(id, item);

    await this.hooks.dispatchAction(
      "media.uploaded",
      { siteId: opts.siteId, mediaId: id, url },
      { siteId: opts.siteId },
    );

    return item;
  }

  async get(id: string): Promise<MediaItem | undefined> {
    return this.items.get(id);
  }

  async list(siteId: string, limit = 50, cursor?: string): Promise<{ items: MediaItem[]; nextCursor?: string }> {
    const all = Array.from(this.items.values())
      .filter((i) => i.siteId === siteId)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

    let start = 0;
    if (cursor) {
      const idx = all.findIndex((i) => i.id === cursor);
      if (idx >= 0) start = idx + 1;
    }

    const page = all.slice(start, start + limit);
    const nextCursor = page.length === limit ? page[page.length - 1]?.id : undefined;
    return nextCursor === undefined ? { items: page } : { items: page, nextCursor };
  }

  async delete(id: string): Promise<void> {
    const item = this.items.get(id);
    if (!item) return;

    await this.hooks.dispatchGate(
      "media.beforeDelete",
      { siteId: item.siteId, mediaId: id },
      { siteId: item.siteId },
    );

    const ext = path.extname(item.filename);
    const key = `${item.siteId}/${id}${ext}`;
    await this.storage.delete(key);

    for (const [name] of Object.entries(item.derivatives)) {
      const dKey = `${item.siteId}/${id}/${name}.webp`;
      await this.storage.delete(dKey).catch(() => null);
    }

    this.items.delete(id);
    await this.hooks.dispatchAction(
      "media.deleted",
      { siteId: item.siteId, mediaId: id },
      { siteId: item.siteId },
    );
  }
}
