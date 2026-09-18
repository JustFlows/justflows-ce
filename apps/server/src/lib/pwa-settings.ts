// SPDX-License-Identifier: MIT

import { getSiteId, getSiteSetting, setSiteSetting } from "./site-settings.js";
import { isSafeAssetUrl } from "./favicon.js";

export type PwaDisplayMode = "standalone" | "fullscreen" | "minimal-ui" | "browser";

export interface PwaShortcut {
  name: string;
  url: string;
  description: string;
}

export interface PwaInstallUi {
  enabled: boolean;
  label: string;
  description: string;
  /** Show the PWA logo mark next to the label/description, not just text. */
  showLogo: boolean;
}

export interface PwaOffline {
  title: string;
  message: string;
  imageUrl: string;
}

export interface PwaAssetCache {
  enabled: boolean;
  maxEntries: number;
  maxAgeSeconds: number;
}

export interface PwaSettings {
  enabled: boolean;
  appName: string;
  shortName: string;
  description: string;
  /** Source upload the generated sizes below are derived from. */
  iconUrl: string;
  icon192Url: string;
  icon512Url: string;
  appleTouchIconUrl: string;
  /** Optional separate source for a maskable (safe-area) icon. */
  maskableIconUrl: string;
  maskableIcon192Url: string;
  maskableIcon512Url: string;
  themeColor: string;
  backgroundColor: string;
  display: PwaDisplayMode;
  startUrl: string;
  shortcuts: PwaShortcut[];
  installUi: PwaInstallUi;
  offline: PwaOffline;
  assetCache: PwaAssetCache;
  /**
   * Bumped on every save. Embedded in the service worker's cache name so a
   * replacement worker's `activate` handler can identify and delete caches
   * left behind by a previous configuration.
   */
  cacheVersion: number;
}

export const PWA_SETTINGS_KEY = "pwa";

export const MAX_SHORTCUTS = 4;

export const DEFAULT_PWA_SETTINGS: PwaSettings = {
  enabled: false,
  appName: "",
  shortName: "",
  description: "",
  iconUrl: "",
  icon192Url: "",
  icon512Url: "",
  appleTouchIconUrl: "",
  maskableIconUrl: "",
  maskableIcon192Url: "",
  maskableIcon512Url: "",
  themeColor: "#111111",
  backgroundColor: "#ffffff",
  display: "standalone",
  startUrl: "/",
  shortcuts: [],
  installUi: { enabled: true, label: "", description: "", showLogo: true },
  offline: { title: "", message: "", imageUrl: "" },
  assetCache: { enabled: true, maxEntries: 100, maxAgeSeconds: 7 * 86_400 },
  cacheVersion: 1,
};

const DISPLAY_MODES = new Set<PwaDisplayMode>(["standalone", "fullscreen", "minimal-ui", "browser"]);

/**
 * A start URL or shortcut destination may never point at these prefixes —
 * they are admin, auth, API, or install surfaces, never public content.
 * Mirrors the intent of `NO_BROWSER_CACHE` in `browser-cache.ts`, but for
 * settings validation rather than response caching.
 */
const BLOCKED_PATH_PREFIXES = /^\/(admin|api|login|install)(\/|$)/;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function asStr(value: unknown, fallback: string, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function asHexColor(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR.test(value.trim()) ? value.trim() : fallback;
}

/** A same-origin, non-admin/auth/api/install public path. Used for start URL and shortcuts. */
export function isSafePublicPath(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\\")) return false;
  if (value.length > 2048) return false;
  return !BLOCKED_PATH_PREFIXES.test(value);
}

function asPublicPath(value: unknown, fallback: string): string {
  return isSafePublicPath(value) ? value : fallback;
}

/** An icon/offline-image URL: same-origin relative, or an absolute http(s) URL. */
function asIconUrl(value: unknown, fallback = ""): string {
  return typeof value === "string" && isSafeAssetUrl(value) ? value.trim() : fallback;
}

function normalizeShortcut(raw: unknown): PwaShortcut | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const name = asStr(r.name, "", 100).trim();
  if (!name || !isSafePublicPath(r.url)) return null;
  return { name, url: r.url as string, description: asStr(r.description, "", 300) };
}

function normalizeShortcuts(raw: unknown): PwaShortcut[] {
  if (!Array.isArray(raw)) return [];
  const out: PwaShortcut[] = [];
  for (const entry of raw) {
    const shortcut = normalizeShortcut(entry);
    if (shortcut) out.push(shortcut);
    if (out.length >= MAX_SHORTCUTS) break;
  }
  return out;
}

function normalizeInstallUi(raw: unknown): PwaInstallUi {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    enabled: asBool(r.enabled, DEFAULT_PWA_SETTINGS.installUi.enabled),
    label: asStr(r.label, DEFAULT_PWA_SETTINGS.installUi.label, 100),
    description: asStr(r.description, DEFAULT_PWA_SETTINGS.installUi.description, 300),
    showLogo: asBool(r.showLogo, DEFAULT_PWA_SETTINGS.installUi.showLogo),
  };
}

function normalizeOffline(raw: unknown): PwaOffline {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    title: asStr(r.title, DEFAULT_PWA_SETTINGS.offline.title, 150),
    message: asStr(r.message, DEFAULT_PWA_SETTINGS.offline.message, 500),
    imageUrl: asIconUrl(r.imageUrl, DEFAULT_PWA_SETTINGS.offline.imageUrl),
  };
}

function normalizeAssetCache(raw: unknown): PwaAssetCache {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    enabled: asBool(r.enabled, DEFAULT_PWA_SETTINGS.assetCache.enabled),
    maxEntries: asInt(r.maxEntries, DEFAULT_PWA_SETTINGS.assetCache.maxEntries, 10, 500),
    maxAgeSeconds: asInt(
      r.maxAgeSeconds,
      DEFAULT_PWA_SETTINGS.assetCache.maxAgeSeconds,
      3600,
      90 * 86_400,
    ),
  };
}

export function normalizePwaSettings(raw: unknown): PwaSettings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const display = DISPLAY_MODES.has(r.display as PwaDisplayMode)
    ? (r.display as PwaDisplayMode)
    : DEFAULT_PWA_SETTINGS.display;
  return {
    enabled: asBool(r.enabled, DEFAULT_PWA_SETTINGS.enabled),
    appName: asStr(r.appName, DEFAULT_PWA_SETTINGS.appName, 100),
    shortName: asStr(r.shortName, DEFAULT_PWA_SETTINGS.shortName, 40),
    description: asStr(r.description, DEFAULT_PWA_SETTINGS.description, 300),
    iconUrl: asIconUrl(r.iconUrl),
    icon192Url: asIconUrl(r.icon192Url),
    icon512Url: asIconUrl(r.icon512Url),
    appleTouchIconUrl: asIconUrl(r.appleTouchIconUrl),
    maskableIconUrl: asIconUrl(r.maskableIconUrl),
    maskableIcon192Url: asIconUrl(r.maskableIcon192Url),
    maskableIcon512Url: asIconUrl(r.maskableIcon512Url),
    themeColor: asHexColor(r.themeColor, DEFAULT_PWA_SETTINGS.themeColor),
    backgroundColor: asHexColor(r.backgroundColor, DEFAULT_PWA_SETTINGS.backgroundColor),
    display,
    startUrl: asPublicPath(r.startUrl, DEFAULT_PWA_SETTINGS.startUrl),
    shortcuts: normalizeShortcuts(r.shortcuts),
    installUi: normalizeInstallUi(r.installUi),
    offline: normalizeOffline(r.offline),
    assetCache: normalizeAssetCache(r.assetCache),
    cacheVersion: asInt(r.cacheVersion, DEFAULT_PWA_SETTINGS.cacheVersion, 1, Number.MAX_SAFE_INTEGER),
  };
}

/** Enabling requires enough configuration to produce a usable manifest. */
export function pwaEnableRequirementsMet(settings: PwaSettings): boolean {
  return Boolean(settings.appName.trim() && settings.icon512Url);
}

export async function getPwaSettings(siteId?: string | null): Promise<PwaSettings> {
  const id = siteId ?? (await getSiteId());
  if (!id) return { ...DEFAULT_PWA_SETTINGS };
  const stored = await getSiteSetting<Record<string, unknown>>(id, PWA_SETTINGS_KEY);
  return normalizePwaSettings(stored ?? {});
}

/**
 * `patch` is deliberately typed as a raw, partially-shaped object rather than
 * `Partial<PwaSettings>` — `normalizePwaSettings` is the source of truth for
 * validating and defaulting it, the same way it treats stored JSON. Nested
 * objects (`installUi`, `offline`, `assetCache`) are shallow-merged onto the
 * current value first, so a patch that only sets one sub-field doesn't reset
 * its siblings back to hardcoded defaults.
 */
export async function savePwaSettings(
  siteId: string,
  patch: Record<string, unknown>,
): Promise<PwaSettings> {
  const current = await getPwaSettings(siteId);
  const next = normalizePwaSettings({
    ...current,
    ...patch,
    installUi: { ...current.installUi, ...(patch.installUi as object | undefined) },
    offline: { ...current.offline, ...(patch.offline as object | undefined) },
    assetCache: { ...current.assetCache, ...(patch.assetCache as object | undefined) },
    cacheVersion: current.cacheVersion + 1,
  });
  if (next.enabled && !pwaEnableRequirementsMet(next)) {
    throw new PwaValidationError("An app name and a 512×512 icon are required to enable the PWA");
  }
  await setSiteSetting(siteId, PWA_SETTINGS_KEY, next);
  return next;
}

export class PwaValidationError extends Error {}
