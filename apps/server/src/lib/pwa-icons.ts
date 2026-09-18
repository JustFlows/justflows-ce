// SPDX-License-Identifier: MIT

import fs from "node:fs/promises";
import { getDb } from "./db.js";
import { uploadsDir } from "./jf-root.js";
import { resolvePathUnderBase } from "./safe-path.js";
import { extractImageMetadata, generateDerivatives } from "@justflows/media";
import { storeMediaUpload, type MediaActor } from "./media-write.js";

/**
 * PWA icon generation (#127).
 *
 * The admin uploads one source image through the existing media library
 * (`MediaImageField`); this derives the fixed sizes a web app manifest needs
 * from it, stored as ordinary media items so they're quota-checked, visible
 * in the library, and cleaned up the same way as any other upload.
 */

export const MIN_ICON_SOURCE_SIZE = 512;

export class PwaIconError extends Error {}

interface MediaSourceRow {
  storage_key: string;
}

async function readUploadBuffer(siteId: string, url: string): Promise<Buffer | null> {
  if (!url.startsWith("/uploads/")) return null;
  const rows = await (
    await getDb()
  ).query<MediaSourceRow>(
    "SELECT storage_key FROM media WHERE site_id = ? AND url = ? AND trashed_at IS NULL LIMIT 1",
    [siteId, url],
  );
  const storageKey = rows[0]?.storage_key;
  if (!storageKey) return null;
  const abs = resolvePathUnderBase(uploadsDir(), storageKey);
  if (!abs) return null;
  try {
    return await fs.readFile(abs);
  } catch {
    return null;
  }
}

export interface GeneratedIconPair {
  url512: string;
  url192: string;
}

/**
 * Resolve `sourceUrl` (an already-uploaded media URL) and generate the two
 * PNG sizes a manifest icon entry needs from it: 512x512 (normalized even
 * when the source is larger) and 192x192. Rejects a source smaller than
 * {@link MIN_ICON_SOURCE_SIZE} in either dimension — blurry upscaled app
 * icons are worse than refusing to enable the feature.
 *
 * The 192px result also serves as the Apple touch icon: iOS accepts and
 * scales any reasonably large touch icon, so a third stored file for an
 * exact 180x180 asset isn't worth the extra media-library entry.
 */
export async function generatePwaIconPair(
  siteId: string,
  actor: MediaActor,
  sourceUrl: string,
  namePrefix: string,
): Promise<GeneratedIconPair> {
  const buffer = await readUploadBuffer(siteId, sourceUrl);
  if (!buffer) {
    throw new PwaIconError("Icon source file could not be read from the media library");
  }

  const meta = await extractImageMetadata(buffer);
  if (meta.width < MIN_ICON_SOURCE_SIZE || meta.height < MIN_ICON_SOURCE_SIZE) {
    throw new PwaIconError(
      `Icon must be at least ${MIN_ICON_SOURCE_SIZE}×${MIN_ICON_SOURCE_SIZE} pixels`,
    );
  }

  const derivatives = await generateDerivatives(buffer, [
    { name: "512", width: 512, height: 512, format: "png", quality: 100 },
    { name: "192", width: 192, height: 192, format: "png", quality: 100 },
  ]);

  const urlByName = new Map<string, string>();
  for (const derivative of derivatives) {
    const result = await storeMediaUpload(
      {
        originalname: `${namePrefix}-${derivative.name}.png`,
        mimetype: "image/png",
        size: derivative.data.byteLength,
        buffer: derivative.data,
      },
      actor,
    );
    if (result.status !== 201) {
      const body = result.body as { error?: string };
      throw new PwaIconError(body.error ?? "Could not store the generated icon");
    }
    urlByName.set(derivative.name, (result.body as { url: string }).url);
  }

  const url512 = urlByName.get("512");
  const url192 = urlByName.get("192");
  if (!url512 || !url192) throw new PwaIconError("Icon generation did not produce both sizes");
  return { url512, url192 };
}
