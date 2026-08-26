// SPDX-License-Identifier: MIT

import type { Response } from "express";
import { ArchiveSafetyError, PackageRejectedError } from "@justflows/installer";

/**
 * Answer a failed package install.
 *
 * Both error types describe something about the uploaded file, so the operator
 * is the one who can act on them and the message is worth sending: a type
 * mismatch names the expected type, and assertPackageIsTrusted's message
 * explains how to pin a digest. Anything else is ours — logged here, and
 * reported as a flat 500, because it is the exception text that would otherwise
 * carry filesystem paths and driver internals into the response.
 */
export function sendPackageInstallError(res: Response, err: unknown): void {
  if (err instanceof PackageRejectedError || err instanceof ArchiveSafetyError) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error("[justflows] package install failed:", err);
  res.status(500).json({ error: "Could not install the package" });
}
