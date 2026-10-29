// SPDX-License-Identifier: MIT

import { Worker } from "node:worker_threads";
import { ARCHIVE_LIMITS, ArchiveSafetyError } from "./archive-safety.js";

/**
 * Extract a gzipped ustar .jfpkg.
 *
 * The bytes are inflated and parsed in a worker the caller can terminate.
 * A malformed archive is rejected there, before this process writes it into
 * the live tree. The worker file is plain JavaScript so it runs from source
 * during tests and from dist in a release image.
 */
export function extractJfpkg(archive: Buffer, dest: string): Promise<void> {
  const workerUrl = new URL("./ustar-worker.mjs", import.meta.url);
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl);
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => {
      finish(new ArchiveSafetyError("Archive processing timed out"));
    }, ARCHIVE_LIMITS.maxParseMs);
    worker.on("message", (msg: { ok?: boolean; message?: string }) => {
      if (msg.ok) finish();
      else finish(new ArchiveSafetyError(msg.message || "Archive rejected"));
    });
    worker.on("error", () => finish(new ArchiveSafetyError("Archive processing failed")));
    worker.on("exit", (code) => {
      if (!settled && code !== 0) finish(new ArchiveSafetyError("Archive processing failed"));
    });
    worker.postMessage({ archive, dest, limits: ARCHIVE_LIMITS });
  });
}
