// SPDX-License-Identifier: MIT

import { getDb } from "./db.js";

/**
 * Ceilings on the media library.
 *
 * multer capped a single upload at 100 MB and nothing capped the total, so any
 * account with author rights could fill the volume one file at a time — which
 * takes the database and the site down with it, not just uploads.
 *
 * Both are advisory limits for a self-hosted CMS rather than a hard quota
 * system: they exist so the failure is a clear 413 rather than a full disk.
 */
function envBytes(name: string, fallbackMb: number): number {
  const raw = Number(process.env[name]);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw) * 1024 * 1024;
  return fallbackMb * 1024 * 1024;
}

/** Largest single upload. */
export function maxUploadBytes(): number {
  return envBytes("JF_MAX_UPLOAD_MB", 100);
}

/** Total the media library may occupy, across all files for a site. */
export function maxLibraryBytes(): number {
  return envBytes("JF_MAX_LIBRARY_MB", 5 * 1024);
}

export interface QuotaCheck {
  ok: boolean;
  usedBytes: number;
  limitBytes: number;
}

/**
 * Whether a new file of `incomingBytes` still fits.
 *
 * A read failure returns ok — a broken SUM should not make the library
 * read-only, and the per-file cap still applies.
 */
export async function checkLibraryQuota(
  siteId: string,
  incomingBytes: number,
): Promise<QuotaCheck> {
  const limitBytes = maxLibraryBytes();
  try {
    const db = await getDb();
    const rows = await db.query<{ total: string | number | null }>(
      "SELECT SUM(size_bytes) AS total FROM media WHERE site_id = ?",
      [siteId],
    );
    const usedBytes = Number(rows[0]?.total ?? 0) || 0;
    return { ok: usedBytes + incomingBytes <= limitBytes, usedBytes, limitBytes };
  } catch {
    return { ok: true, usedBytes: 0, limitBytes };
  }
}

export function formatMb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}
