// SPDX-License-Identifier: MIT

import fs from "node:fs/promises";
import path from "node:path";
import { getDb } from "./db.js";
import { uploadsDir } from "./jf-root.js";
import { resolvePathUnderBase } from "./safe-path.js";
import { generateAndStoreVariants, resolveImageConfig } from "./media-responsive.js";

/**
 * Admin → Tools "Regenerate responsive images" job (#103).
 *
 * Walks every non-trashed image in a site's library, rebuilds its variant set
 * with the current configuration, and updates the row. Runs in-process, one
 * site at a time, with a progress snapshot the Tools page polls. This is a
 * maintenance action for when the size set or formats change — normal uploads
 * generate their variants inline.
 */

export interface RegenerateProgress {
  running: boolean;
  total: number;
  processed: number;
  skipped: number;
  failed: number;
  startedAt: string | null;
  finishedAt: string | null;
  currentFile: string | null;
  errors: string[];
}

interface JobState extends RegenerateProgress {
  siteId: string | null;
}

const state: JobState = {
  siteId: null,
  running: false,
  total: 0,
  processed: 0,
  skipped: 0,
  failed: 0,
  startedAt: null,
  finishedAt: null,
  currentFile: null,
  errors: [],
};

export function regenerateStatus(): RegenerateProgress {
  const { siteId: _siteId, ...snapshot } = state;
  return { ...snapshot, errors: [...snapshot.errors] };
}

function now(): string {
  return new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
}

interface MediaRow {
  id: string;
  filename: string;
  mime_type: string;
  storage_key: string;
  focal_x: number | string | null;
  focal_y: number | string | null;
}

async function processRow(siteId: string, row: MediaRow): Promise<"done" | "skipped" | "failed"> {
  const abs = resolvePathUnderBase(uploadsDir(), row.storage_key);
  if (!abs) return "failed";
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(abs);
  } catch {
    return "failed";
  }

  const focalX = row.focal_x == null ? null : Number(row.focal_x);
  const focalY = row.focal_y == null ? null : Number(row.focal_y);

  const derivatives = await generateAndStoreVariants({
    siteId,
    mediaId: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    buffer,
    focal:
      focalX != null && focalY != null && Number.isFinite(focalX) && Number.isFinite(focalY)
        ? { x: focalX, y: focalY }
        : null,
  });

  if (!derivatives) return "skipped";

  await (
    await getDb()
  ).run(
    "UPDATE media SET derivatives = ?, width = ?, height = ?, original_format = ?, variants_generated_at = ?, updated_at = ? WHERE id = ? AND site_id = ?",
    [
      JSON.stringify(derivatives),
      derivatives.base.w,
      derivatives.base.h,
      derivatives.base.format,
      now(),
      now(),
      row.id,
      siteId,
    ],
  );
  return "done";
}

/** Start a regeneration run for a site. Returns false if one is already running. */
export function startRegenerate(siteId: string): boolean {
  if (state.running) return false;

  Object.assign(state, {
    siteId,
    running: true,
    total: 0,
    processed: 0,
    skipped: 0,
    failed: 0,
    startedAt: now(),
    finishedAt: null,
    currentFile: null,
    errors: [],
  });

  void (async () => {
    try {
      if (!resolveImageConfig().enabled) {
        state.errors.push("Responsive images are disabled — enable them and save first.");
        return;
      }
      const rows = await (
        await getDb()
      ).query<MediaRow>(
        "SELECT id, filename, mime_type, storage_key, focal_x, focal_y FROM media WHERE site_id = ? AND trashed_at IS NULL AND mime_type LIKE 'image/%' ORDER BY uploaded_at DESC",
        [siteId],
      );
      state.total = rows.length;

      for (const row of rows) {
        state.currentFile = row.filename;
        try {
          const outcome = await processRow(siteId, row);
          if (outcome === "done") state.processed += 1;
          else if (outcome === "skipped") state.skipped += 1;
          else {
            state.failed += 1;
            if (state.errors.length < 50) state.errors.push(`Failed: ${row.filename}`);
          }
        } catch (err) {
          state.failed += 1;
          if (state.errors.length < 50) {
            state.errors.push(
              `Failed: ${row.filename} — ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    } catch (err) {
      state.errors.push(err instanceof Error ? err.message : String(err));
    } finally {
      state.running = false;
      state.finishedAt = now();
      state.currentFile = null;
      // New derivatives change public markup — drop cached pages so the next
      // request re-renders with the updated srcset.
      try {
        const { wipeCacheStorage, resetJfCache } = await import("./jf-cache.js");
        await wipeCacheStorage();
        resetJfCache();
      } catch {
        // cache not enabled / not initialised
      }
    }
  })();

  return true;
}
