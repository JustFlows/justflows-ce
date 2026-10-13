// SPDX-License-Identifier: MIT

import { getDb } from "../database/db.js";
import type { JobQueueRow } from "../jobs/job-queue-db.js";
import type { QueuedJobResult } from "../jobs/job-queue.js";
import { DerivativeBudgetError, generateAndStoreVariants, moveVariantDir, removeVariantDir } from "./media-responsive.js";
import { recordVariants } from "./media-write.js";
import { readUpload } from "./upload-store.js";

/**
 * Background generation of an upload's responsive variants.
 *
 * Encoding an image into ~20 sizes and formats takes seconds to tens of
 * seconds on a small server, so an upload stores the original, reserves room
 * for the variants on its row (`derivative_bytes`) and queues this job; the
 * request answers straight away. The job builds the set within that
 * reservation and records it, or releases the reservation when there is
 * nothing to build. Runs on the durable queue, so a restart resumes it.
 */

const JOB_NAME = "core.media-variants";
const MAX_ATTEMPTS = 3;

interface MediaVariantPayload {
  mediaId: string;
}

let registered = false;

async function queue() {
  const { getDurableJobQueue } = await import("../plugins/plugin-jobs.js");
  const q = getDurableJobQueue();
  if (!registered) {
    q.register(JOB_NAME, { maxAttempts: MAX_ATTEMPTS, run: runMediaVariantJob });
    registered = true;
  }
  return q;
}

/** Register the handler at boot, so runs queued before a restart are picked up. */
export async function startMediaVariantJobs(): Promise<void> {
  await queue();
}

/** Queue variant generation for an upload. False when the job table is missing (caller runs it inline). */
export async function queueMediaVariants(siteId: string, mediaId: string): Promise<boolean> {
  const q = await queue();
  if (!(await q.isAvailable())) return false;
  await q.enqueue(JOB_NAME, { siteId, payload: { mediaId } satisfies MediaVariantPayload });
  return true;
}

async function releaseReservation(siteId: string, mediaId: string): Promise<void> {
  await (await getDb()).run(
    "UPDATE media SET derivative_bytes = 0 WHERE id = ? AND site_id = ? AND variants_generated_at IS NULL",
    [mediaId, siteId],
  );
}

export async function runMediaVariantJob(job: JobQueueRow): Promise<QueuedJobResult> {
  const siteId = job.siteId;
  const mediaId = (job.payload as Partial<MediaVariantPayload> | null)?.mediaId;
  if (!siteId || typeof mediaId !== "string") return { success: true, message: "Nothing to do: no media id." };

  const { runWithSiteDatabase } = await import("../tenancy/provision.js");
  return runWithSiteDatabase(siteId, async () => {
    const db = await getDb();
    const rows = await db.query<{
      filename: string;
      mime_type: string;
      storage_key: string;
      derivative_bytes: number | string | null;
      trashed_at: unknown;
    }>(
      "SELECT filename, mime_type, storage_key, derivative_bytes, trashed_at FROM media WHERE id = ? AND site_id = ? LIMIT 1",
      [mediaId, siteId],
    );
    const row = rows[0];
    if (!row) return { success: true, message: "The media item was deleted." };
    if (row.trashed_at) {
      await releaseReservation(siteId, mediaId);
      return { success: true, message: "The media item was trashed." };
    }
    // The upload reserved this much; the set may not grow past it.
    const budget = Number(row.derivative_bytes) || 0;
    if (budget <= 0) return { success: true, message: "No room was reserved for variants." };

    const buffer = await readUpload(String(row.storage_key));
    if (!buffer) {
      if (job.attempts >= job.maxAttempts) await releaseReservation(siteId, mediaId);
      return { success: false, message: "The original could not be read." };
    }

    let derivatives;
    try {
      derivatives = await generateAndStoreVariants({
        siteId,
        mediaId,
        filename: String(row.filename),
        mimeType: String(row.mime_type),
        buffer,
        focal: null,
        maxBytes: budget,
      });
    } catch (err) {
      // Too large or undecodable fails the same way every time; storage
      // errors are retried while attempts remain.
      const final = err instanceof DerivativeBudgetError || job.attempts >= job.maxAttempts;
      if (final) await releaseReservation(siteId, mediaId);
      console.error("[justflows] media variant job failed:", (err instanceof Error ? err.message : String(err)).replace(/[\r\n]+/g, " "));
      if (err instanceof DerivativeBudgetError) return { success: true, message: err.message };
      throw err;
    }

    // Trashed or deleted while the set was being built: put the files where
    // the item now is instead of leaving them in the live folder.
    const after = await db.query<{ trashed_at: unknown }>(
      "SELECT trashed_at FROM media WHERE id = ? AND site_id = ? LIMIT 1",
      [mediaId, siteId],
    );
    if (!after[0]) {
      await removeVariantDir(siteId, mediaId);
      return { success: true, message: "The media item was deleted." };
    }
    if (after[0].trashed_at) await moveVariantDir(siteId, mediaId, true).catch(() => undefined);
    await recordVariants(siteId, mediaId, derivatives);
    return { success: true };
  });
}
