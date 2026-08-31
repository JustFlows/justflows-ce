// SPDX-License-Identifier: MIT

import { sanitizeBlockDocument } from "@justflows/blocks";
import { isSafeCssColor } from "./theme-customize.js";
import type { BlockNode } from "./types.js";

export const PAGE_HEADER_FIELD = "jfHeader";

/**
 * Which header from the site header library a page renders. Stored alongside
 * {@link PAGE_HEADER_FIELD} on a content row's `fields`. An unset ref means the
 * page follows the site default header.
 */
export const PAGE_HEADER_REF_FIELD = "jfHeaderRef";

/** Page follows whichever library entry the site marks as its default. */
export const SITE_DEFAULT_HEADER_REF = "__default__";

/** Page renders no header at all. */
export const NO_HEADER_REF = "__none__";

export const HEADER_LAYOUTS = ["logo-left", "logo-center", "split"] as const;
export type HeaderLayout = (typeof HEADER_LAYOUTS)[number];

export const HEADER_MENU_MODES = ["inherit", "menu", "none"] as const;
export type HeaderMenuMode = (typeof HEADER_MENU_MODES)[number];

export const HEADER_LANGUAGE_SWITCHER_STYLES = ["locale-full", "locale-short", "flags", "flag-locale", "flag-country"] as const;
export type HeaderLanguageSwitcherStyle = (typeof HEADER_LANGUAGE_SWITCHER_STYLES)[number];

const MENU_SLUG = /^[a-z0-9-]{0,255}$/;

export interface PageHeaderConfig {
  visible: boolean;
  menuMode: HeaderMenuMode;
  menuSlug: string;
  showLogo: boolean;
  showTitle: boolean;
  layout: HeaderLayout;
  sticky: boolean;
  background: string;
  showLanguageSwitcher: boolean;
  languageSwitcherStyle: HeaderLanguageSwitcherStyle;
  showColorScheme: boolean;
  showColorSchemeSystem: boolean;
  showAuthLinks: boolean;
  blocks: BlockNode[];
}

export const DEFAULT_PAGE_HEADER: PageHeaderConfig = {
  visible: true,
  menuMode: "inherit",
  menuSlug: "",
  showLogo: true,
  showTitle: true,
  layout: "logo-left",
  sticky: true,
  background: "",
  showLanguageSwitcher: true,
  languageSwitcherStyle: "locale-short",
  showColorScheme: false,
  showColorSchemeSystem: false,
  showAuthLinks: false,
  blocks: [],
};

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1) return true;
  if (value === "false" || value === 0) return false;
  return fallback;
}

function asMenuMode(value: unknown): HeaderMenuMode {
  return HEADER_MENU_MODES.includes(value as HeaderMenuMode)
    ? (value as HeaderMenuMode)
    : DEFAULT_PAGE_HEADER.menuMode;
}

function asLayout(value: unknown): HeaderLayout {
  return HEADER_LAYOUTS.includes(value as HeaderLayout)
    ? (value as HeaderLayout)
    : DEFAULT_PAGE_HEADER.layout;
}

function asLanguageSwitcherStyle(value: unknown): HeaderLanguageSwitcherStyle {
  return HEADER_LANGUAGE_SWITCHER_STYLES.includes(value as HeaderLanguageSwitcherStyle)
    ? (value as HeaderLanguageSwitcherStyle)
    : DEFAULT_PAGE_HEADER.languageSwitcherStyle;
}

function asMenuSlug(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return MENU_SLUG.test(trimmed) ? trimmed : "";
}

function asBackground(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return isSafeCssColor(trimmed) ? trimmed : "";
}

/**
 * Normalize only the header fields actually present in `raw`, each through the
 * same validators as {@link parsePageHeader}. An absent key is left out of the
 * result, which is what makes this usable for the sparse per-locale overrides
 * in the site header library (missing key == "inherit from base").
 */
export function parsePageHeaderPatch(raw: unknown): Partial<PageHeaderConfig> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  const patch: Partial<PageHeaderConfig> = {};
  if ("visible" in input) patch.visible = asBoolean(input.visible, DEFAULT_PAGE_HEADER.visible);
  if ("menuMode" in input) patch.menuMode = asMenuMode(input.menuMode);
  if ("menuSlug" in input) patch.menuSlug = asMenuSlug(input.menuSlug);
  if ("showLogo" in input) patch.showLogo = asBoolean(input.showLogo, DEFAULT_PAGE_HEADER.showLogo);
  if ("showTitle" in input) patch.showTitle = asBoolean(input.showTitle, DEFAULT_PAGE_HEADER.showTitle);
  if ("layout" in input) patch.layout = asLayout(input.layout);
  if ("sticky" in input) patch.sticky = asBoolean(input.sticky, DEFAULT_PAGE_HEADER.sticky);
  if ("background" in input) patch.background = asBackground(input.background);
  if ("showLanguageSwitcher" in input)
    patch.showLanguageSwitcher = asBoolean(input.showLanguageSwitcher, DEFAULT_PAGE_HEADER.showLanguageSwitcher);
  if ("languageSwitcherStyle" in input)
    patch.languageSwitcherStyle = asLanguageSwitcherStyle(input.languageSwitcherStyle);
  if ("showColorScheme" in input)
    patch.showColorScheme = asBoolean(input.showColorScheme, DEFAULT_PAGE_HEADER.showColorScheme);
  if ("showColorSchemeSystem" in input)
    patch.showColorSchemeSystem = asBoolean(input.showColorSchemeSystem, DEFAULT_PAGE_HEADER.showColorSchemeSystem);
  if ("showAuthLinks" in input)
    patch.showAuthLinks = asBoolean(input.showAuthLinks, DEFAULT_PAGE_HEADER.showAuthLinks);
  if ("blocks" in input) patch.blocks = parseHeaderBlocks(input.blocks);
  return patch;
}

/**
 * Overlay a sparse patch onto a full header config. Shallow — patch keys win,
 * and `blocks`, when present, replaces the base list wholesale.
 */
export function mergePageHeader(
  base: PageHeaderConfig,
  patch: Partial<PageHeaderConfig> | undefined,
): PageHeaderConfig {
  const merged = { ...base, ...(patch ?? {}) };
  return { ...merged, blocks: [...merged.blocks] };
}

/** Normalize stored or inbound header chrome for a page. */
export function parsePageHeader(raw: unknown): PageHeaderConfig {
  return mergePageHeader(DEFAULT_PAGE_HEADER, parsePageHeaderPatch(raw));
}

/**
 * The header library ref stored on a page (see {@link PAGE_HEADER_REF_FIELD}),
 * or {@link SITE_DEFAULT_HEADER_REF} when the page has never chosen one.
 */
export function headerRefFromContentFields(
  fields: Record<string, unknown> | null | undefined,
): string {
  const raw = fields?.[PAGE_HEADER_REF_FIELD];
  return typeof raw === "string" && raw.trim() ? raw.trim() : SITE_DEFAULT_HEADER_REF;
}

const MAX_HEADER_BLOCKS = 40;

function parseHeaderBlocks(raw: unknown): BlockNode[] {
  if (!Array.isArray(raw)) return [];
  const sanitized = sanitizeBlockDocument({ version: 1, blocks: raw.slice(0, MAX_HEADER_BLOCKS) });
  return (sanitized.blocks as BlockNode[]).filter(
    (node) => node && typeof node === "object" && typeof node.type === "string",
  );
}

export function headerFromContentFields(fields: Record<string, unknown> | null | undefined): PageHeaderConfig {
  return parsePageHeader(fields?.[PAGE_HEADER_FIELD]);
}

export function withPageHeader(
  fields: Record<string, unknown> | null | undefined,
  header: PageHeaderConfig,
): Record<string, unknown> {
  return {
    ...(fields ?? {}),
    [PAGE_HEADER_FIELD]: parsePageHeader(header),
  };
}

/** What the public header should actually render for brand chrome. */
export function headerBrandFlags(
  header: PageHeaderConfig,
  logoUrl: string | null | undefined,
): { showLogo: boolean; showTitle: boolean } {
  return {
    showLogo: header.showLogo && Boolean(logoUrl),
    showTitle: header.showTitle,
  };
}
export function resolveHeaderMenuSlug(
  header: PageHeaderConfig,
  siteDefaultSlug: string | null | undefined,
): string | null {
  if (!header.visible || header.menuMode === "none") return null;
  if (header.menuMode === "menu") return header.menuSlug || null;
  const inherited = siteDefaultSlug?.trim();
  return inherited ? inherited : "primary";
}
