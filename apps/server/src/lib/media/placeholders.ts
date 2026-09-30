// SPDX-License-Identifier: MIT

import {
  CORE_PLACEHOLDER_KINDS,
  type CorePlaceholderKind,
  type PlaceholderHtmlOptions,
  type PlaceholderImage,
} from "@justflows/sdk";
import { placeholderImgHtml } from "@justflows/plugin-api";
import { getPluginLoader, getRuntimeHooks } from "../plugins/plugin-runtime.js";
import { getSiteId, getSiteSetting, setSiteSetting } from "../settings/site-settings.js";

/**
 * Placeholder images for empty image slots.
 *
 * Justflows ships one neutral image per core kind under `public/placeholders/`.
 * A kind resolves, first match wins, to: the site owner's image → the
 * `media.placeholder` filter over (plugin-registered image → shipped default,
 * `generic` for an unknown kind). Plugins read the same resolver through
 * `ctx.media.placeholder`.
 *
 * Plugin block `render()` is synchronous, so resolution is too. Site settings
 * are cached per site; `primePlaceholders` warms the cache before a public
 * render, and a lookup against a cold cache uses the shipped defaults.
 */

export const PLACEHOLDER_SETTINGS_KEY = "media.placeholders";

interface ShippedPlaceholder {
  src: string;
  width: number;
  height: number;
  label: string;
}

export const SHIPPED_PLACEHOLDERS: Record<CorePlaceholderKind, ShippedPlaceholder> = {
  generic: { src: "/placeholders/generic.svg", width: 800, height: 600, label: "Generic image" },
  featured: { src: "/placeholders/featured.svg", width: 1600, height: 900, label: "Featured image" },
  thumbnail: { src: "/placeholders/thumbnail.svg", width: 600, height: 600, label: "Thumbnail" },
  avatar: { src: "/placeholders/avatar.svg", width: 256, height: 256, label: "Avatar" },
  // Social crawlers do not render SVG, so the share image is a PNG.
  og: { src: "/placeholders/og.png", width: 1200, height: 630, label: "Social share image" },
};

export interface SitePlaceholderImage {
  url: string;
  width: number;
  height: number;
}

export interface PlaceholderSettings {
  enabled: boolean;
  /** Site owner's own image per kind; a missing kind uses the default. */
  images: Record<string, SitePlaceholderImage>;
}

const DEFAULT_SETTINGS: PlaceholderSettings = { enabled: true, images: {} };
const TTL_MS = 30_000;

const cache = new Map<string, { at: number; settings: PlaceholderSettings }>();
const loading = new Map<string, Promise<PlaceholderSettings>>();

function isCoreKind(kind: string): kind is CorePlaceholderKind {
  return (CORE_PLACEHOLDER_KINDS as readonly string[]).includes(kind);
}

function positiveInt(value: unknown): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 && n <= 10_000 ? n : 0;
}

/** Only uploads and https URLs are accepted from stored settings. */
function isSiteImageUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 2048 &&
    (/^\/uploads\/[^\s"'<>\\]+$/.test(value) || /^https:\/\/[^\s"'<>]+$/i.test(value))
  );
}

export function normalizePlaceholderSettings(raw: unknown): PlaceholderSettings {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const images: Record<string, SitePlaceholderImage> = {};
  const rawImages =
    row.images && typeof row.images === "object" ? (row.images as Record<string, unknown>) : {};
  for (const [kind, value] of Object.entries(rawImages)) {
    const entry = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    if (!isSiteImageUrl(entry.url)) continue;
    images[kind] = {
      url: entry.url,
      width: positiveInt(entry.width),
      height: positiveInt(entry.height),
    };
  }
  return { enabled: row.enabled !== false, images };
}

async function loadSettings(siteId: string): Promise<PlaceholderSettings> {
  try {
    const raw = await getSiteSetting<unknown>(siteId, PLACEHOLDER_SETTINGS_KEY);
    return normalizePlaceholderSettings(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Warm the per-site settings cache. Cheap when it is already fresh. */
export async function primePlaceholders(siteId: string | null | undefined): Promise<void> {
  if (!siteId) return;
  const hit = cache.get(siteId);
  if (hit && Date.now() - hit.at < TTL_MS) return;
  let pending = loading.get(siteId);
  if (!pending) {
    pending = loadSettings(siteId).finally(() => loading.delete(siteId));
    loading.set(siteId, pending);
  }
  cache.set(siteId, { at: Date.now(), settings: await pending });
}

export function invalidatePlaceholders(siteId?: string): void {
  if (siteId) cache.delete(siteId);
  else cache.clear();
}

function cachedSettings(siteId: string): PlaceholderSettings {
  const hit = cache.get(siteId);
  if (!hit || Date.now() - hit.at >= TTL_MS) void primePlaceholders(siteId).catch(() => {});
  return hit?.settings ?? DEFAULT_SETTINGS;
}

/** Plugin-registered image, else the shipped one. Ignores site settings and filters. */
export function defaultPlaceholder(kind: string): PlaceholderImage {
  const registered = getPluginLoader()?.placeholderRegistry.get(kind);
  if (registered) {
    return {
      kind,
      src: registered.src,
      width: registered.width,
      height: registered.height,
      source: "plugin",
    };
  }
  const shipped = SHIPPED_PLACEHOLDERS[isCoreKind(kind) ? kind : "generic"];
  return { kind, src: shipped.src, width: shipped.width, height: shipped.height, source: "core" };
}

/**
 * The placeholder for `kind`, or `null` when the site switched placeholders
 * off or a filter cleared it. Synchronous; see the module comment.
 */
export function resolvePlaceholderSync(siteId: string, kind: string): PlaceholderImage | null {
  const settings = cachedSettings(siteId);
  if (!settings.enabled) return null;

  const fallback = defaultPlaceholder(kind);
  const own = settings.images[kind];
  if (own) {
    return {
      kind,
      src: own.url,
      width: own.width || fallback.width,
      height: own.height || fallback.height,
      source: "site",
    };
  }

  const hooks = getRuntimeHooks();
  if (!hooks.has("media.placeholder")) return fallback;
  const filtered = hooks.applyFilterSync<PlaceholderImage | null>(
    "media.placeholder",
    fallback,
    { siteId, kind },
    { siteId, source: "http" },
  );
  if (filtered === null) return null;
  return sanitizeFiltered(filtered, fallback);
}

/** A filter is plugin code: keep its image only when it is well formed. */
function sanitizeFiltered(value: unknown, fallback: PlaceholderImage): PlaceholderImage {
  if (!value || typeof value !== "object") return fallback;
  const row = value as Record<string, unknown>;
  const src = row.src;
  const safe =
    typeof src === "string" &&
    src.length <= 2048 &&
    ((src.startsWith("/") && !src.startsWith("//") && !/[\s"'<>\\]/.test(src)) ||
      /^https:\/\/[^\s"'<>]+$/i.test(src));
  if (!safe) return fallback;
  if (src === fallback.src) return fallback;
  return {
    kind: fallback.kind,
    src,
    width: positiveInt(row.width) || fallback.width,
    height: positiveInt(row.height) || fallback.height,
    source: "filter",
  };
}

export async function resolvePlaceholder(
  kind: string,
  siteId?: string | null,
): Promise<PlaceholderImage | null> {
  // A placeholder lookup must never fail a page render.
  const id = siteId ?? (await getSiteId().catch(() => null));
  if (!id) return null;
  await primePlaceholders(id);
  return resolvePlaceholderSync(id, kind);
}

/** `<img>` for `kind`, or `""` when placeholders are off for the site. */
export async function renderPlaceholder(
  kind: string,
  options: PlaceholderHtmlOptions & { siteId?: string | null } = {},
): Promise<string> {
  const image = await resolvePlaceholder(kind, options.siteId);
  return image ? placeholderImgHtml(image, options) : "";
}

// ─── Admin ────────────────────────────────────────────────────────────────

export interface PlaceholderKindRow {
  kind: string;
  label: string;
  /** `core` or the registering plugin's id. */
  owner: string;
  defaultSrc: string;
  width: number;
  height: number;
  /** Site owner's own image, when set. */
  custom: SitePlaceholderImage | null;
}

export async function getPlaceholderAdminState(
  siteId: string,
): Promise<{ enabled: boolean; kinds: PlaceholderKindRow[] }> {
  const settings = await loadSettings(siteId);
  const rows: PlaceholderKindRow[] = CORE_PLACEHOLDER_KINDS.map((kind) => ({
    kind,
    label: SHIPPED_PLACEHOLDERS[kind].label,
    owner: "core",
    defaultSrc: SHIPPED_PLACEHOLDERS[kind].src,
    width: SHIPPED_PLACEHOLDERS[kind].width,
    height: SHIPPED_PLACEHOLDERS[kind].height,
    custom: settings.images[kind] ?? null,
  }));
  for (const entry of getPluginLoader()?.placeholderRegistry.all() ?? []) {
    rows.push({
      kind: entry.kind,
      label: entry.label ?? entry.kind,
      owner: entry.pluginId,
      defaultSrc: entry.src,
      width: entry.width,
      height: entry.height,
      custom: settings.images[entry.kind] ?? null,
    });
  }
  return { enabled: settings.enabled, kinds: rows };
}

export async function savePlaceholderSettings(
  siteId: string,
  input: { enabled?: boolean; images?: Record<string, { url: string } | null> },
  lookupSize: (url: string) => Promise<{ width: number; height: number } | null>,
): Promise<PlaceholderSettings> {
  const current = await loadSettings(siteId);
  const next: PlaceholderSettings = {
    enabled: input.enabled ?? current.enabled,
    images: { ...current.images },
  };
  for (const [kind, value] of Object.entries(input.images ?? {})) {
    if (!value || !value.url) {
      delete next.images[kind];
      continue;
    }
    if (!isSiteImageUrl(value.url)) {
      throw new PlaceholderValidationError(
        `Placeholder for "${kind}" must be a media library image or an https: URL`,
      );
    }
    const size = (await lookupSize(value.url)) ?? { width: 0, height: 0 };
    next.images[kind] = { url: value.url, width: size.width, height: size.height };
  }
  await setSiteSetting(siteId, PLACEHOLDER_SETTINGS_KEY, next);
  invalidatePlaceholders(siteId);
  return next;
}

export class PlaceholderValidationError extends Error {}
