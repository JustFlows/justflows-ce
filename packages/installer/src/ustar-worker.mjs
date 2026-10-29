// SPDX-License-Identifier: MIT

import { parentPort } from "node:worker_threads";
import { extractTarGz } from "./ustar.mjs";

/**
 * Runs .jfpkg inflation and extraction off the request thread.
 * The parent terminates this worker when the time limit expires.
 */
if (!parentPort) {
  throw new Error("Archive worker requires a parent port");
}

parentPort.on("message", (msg) => {
  const archive = Buffer.from(msg.archive);
  extractTarGz(archive, msg.dest, msg.limits)
    .then(() => parentPort.postMessage({ ok: true }))
    .catch((err) => {
      const message = err instanceof Error ? err.message : "Archive rejected";
      parentPort.postMessage({ ok: false, message });
    });
});
