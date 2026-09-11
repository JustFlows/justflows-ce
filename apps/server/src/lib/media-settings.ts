// SPDX-License-Identifier: MIT

import path from "node:path";
import { z } from "zod";
import { getJfRoot } from "./jf-root.js";
import { applyEnvToProcess, updateEnvKeys } from "./env-file.js";
import { resolveImageConfig } from "./media-responsive.js";
import { responsiveMarkupEnabled } from "./responsive-media.js";

/**
 * Read / write the responsive-image configuration (#103) from the app `.env` as
 * `JF_IMAGE_*` keys. Mirrors `cache-settings.ts`, but no restart is needed:
 * `media-responsive.ts` reads the environment live, so the next upload and the
 * next Tools regeneration run pick the new values up immediately.
 */

export const MediaSettingsBodySchema = z.object({
  enabled: z.boolean(),
  responsiveMarkup: z.boolean(),
  avif: z.boolean(),
  widths: z.array(z.coerce.number().int().min(16).max(8192)).min(1).max(12),
  maxWidth: z.coerce.number().int().min(320).max(8192),
  qualityWebp: z.coerce.number().int().min(1).max(100),
  qualityAvif: z.coerce.number().int().min(1).max(100),
  qualityJpeg: z.coerce.number().int().min(1).max(100),
  stripMetadata: z.boolean(),
  thumbnailSize: z.coerce.number().int().min(0).max(2048),
  keepOriginal: z.string().max(500),
});

export type MediaSettings = z.infer<typeof MediaSettingsBodySchema>;

export interface MediaSettingsResponse {
  settings: MediaSettings;
  envPath: string;
}

/** Current settings, derived from the same env resolution the pipeline uses. */
export async function readMediaSettings(): Promise<MediaSettingsResponse> {
  const { enabled, config, keepOriginalGlobs } = resolveImageConfig();
  return {
    settings: {
      enabled,
      responsiveMarkup: responsiveMarkupEnabled(),
      avif: config.formats.includes("avif"),
      widths: config.widths,
      maxWidth: config.maxWidth,
      qualityWebp: config.quality.webp,
      qualityAvif: config.quality.avif,
      qualityJpeg: config.quality.jpeg,
      stripMetadata: config.stripMetadata,
      thumbnailSize: config.thumbnail ? config.thumbnail.width : 0,
      keepOriginal: keepOriginalGlobs.join(", "),
    },
    envPath: path.join(getJfRoot(), ".env"),
  };
}

function toEnvUpdates(body: MediaSettings): Record<string, string | null> {
  const widths = [...new Set(body.widths)].sort((a, b) => a - b);
  const formats = body.avif ? "webp,avif" : "webp";
  const globs = body.keepOriginal
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(",");
  return {
    JF_IMAGE_DERIVATIVES: body.enabled ? "1" : "0",
    JF_IMAGE_RESPONSIVE_MARKUP: body.responsiveMarkup ? "1" : "0",
    JF_IMAGE_FORMATS: formats,
    JF_IMAGE_WIDTHS: widths.join(","),
    JF_IMAGE_MAX_WIDTH: String(body.maxWidth),
    JF_IMAGE_QUALITY_WEBP: String(body.qualityWebp),
    JF_IMAGE_QUALITY_AVIF: String(body.qualityAvif),
    JF_IMAGE_QUALITY_JPEG: String(body.qualityJpeg),
    JF_IMAGE_STRIP_METADATA: body.stripMetadata ? "1" : "0",
    JF_IMAGE_THUMB: body.thumbnailSize > 0 ? `${body.thumbnailSize}x${body.thumbnailSize}` : "off",
    JF_IMAGE_KEEP_ORIGINAL: globs ? globs : null,
  };
}

/** Persist settings to `.env` and apply them to the running process. */
export async function applyMediaSettings(
  body: unknown,
): Promise<MediaSettingsResponse & { ok: true }> {
  const parsed = MediaSettingsBodySchema.parse(body);
  const updates = toEnvUpdates(parsed);
  await updateEnvKeys(updates);
  applyEnvToProcess(updates);
  return { ok: true, ...(await readMediaSettings()) };
}
