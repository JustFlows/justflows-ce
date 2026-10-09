// SPDX-License-Identifier: MIT

import { pipeline } from "node:stream/promises";
import type { Request, Response } from "express";
import { getSiteId } from "../settings/site-settings.js";
import { getTenantContext } from "../tenancy/context.js";
import { openPrivateFile, PrivateStorageError } from "./private-storage.js";

/** `Content-Disposition` with an ASCII fallback and the UTF-8 name. */
export function contentDisposition(disposition: "attachment" | "inline", filename: string): string {
  const clean = filename.replace(/[\r\n"\\/]+/g, "").trim().slice(0, 200) || "download";
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

/**
 * Stream one of a plugin's private files to the client. The plugin only names
 * its own key; the site comes from the request and the storage address never
 * leaves the server.
 */
export async function sendPrivateFile(
  req: Request,
  res: Response,
  pluginId: string,
  file: { key: string; filename?: string; disposition?: "attachment" | "inline" },
): Promise<void> {
  const siteId = getTenantContext()?.siteId ?? (await getSiteId());
  let opened: Awaited<ReturnType<typeof openPrivateFile>> = null;
  try {
    opened = siteId ? await openPrivateFile(siteId, pluginId, file.key, req.get("range") ?? undefined) : null;
  } catch (err) {
    if (!(err instanceof PrivateStorageError)) {
      console.error(`[justflows] plugin "${pluginId}" file could not be opened:`, err instanceof Error ? err.message : "unknown error");
      res.status(502).json({ error: "The file could not be read from storage." });
      return;
    }
  }
  if (!opened) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  const name = file.filename || file.key.split("/").pop() || "download";
  res.status(opened.status);
  res.setHeader("Content-Type", opened.contentType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", contentDisposition(file.disposition ?? "attachment", name));
  if (opened.contentRange) {
    res.setHeader("Content-Range", opened.contentRange);
    const [start, end] = opened.contentRange.replace(/^bytes /, "").split("/")[0]!.split("-").map(Number);
    if (Number.isFinite(start) && Number.isFinite(end)) res.setHeader("Content-Length", String(end! - start! + 1));
  } else if (opened.size > 0) {
    res.setHeader("Content-Length", String(opened.size));
  }
  if (req.method === "HEAD") {
    opened.body.destroy();
    res.end();
    return;
  }
  try {
    await pipeline(opened.body, res);
  } catch {
    // The client went away mid-download; nothing to send.
  }
}
