// SPDX-License-Identifier: MIT

import { sanitizeBlockDocument } from "@justflows/blocks";
import { isSafeCssColor } from "./theme-customize.js";
import type { BlockNode } from "./types.js";

export const PAGE_HEADER_FIELD = "jfHeader";

export const HEADER_LAYOUTS = ["logo-left", "logo-center", "split"] as const;
export type HeaderLayout = (typeof HEADER_LAYOUTS)[number];

export const HEADER_MENU_MODES = ["inherit", "menu", "none"] as const;
export type HeaderMenuMode = (typeof HEADER_MENU_MODES)[number];

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

/** Normalize stored or inbound header chrome for a page. */
export function parsePageHeader(raw: unknown): PageHeaderConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_PAGE_HEADER };
  }
  const input = raw as Record<string, unknown>;
  return {
    visible: asBoolean(input.visible, DEFAULT_PAGE_HEADER.visible),
    menuMode: asMenuMode(input.menuMode),
    menuSlug: asMenuSlug(input.menuSlug),
    showLogo: asBoolean(input.showLogo, DEFAULT_PAGE_HEADER.showLogo),
    showTitle: asBoolean(input.showTitle, DEFAULT_PAGE_HEADER.showTitle),
    layout: asLayout(input.layout),
    sticky: asBoolean(input.sticky, DEFAULT_PAGE_HEADER.sticky),
    background: asBackground(input.background),
    showLanguageSwitcher: asBoolean(input.showLanguageSwitcher, DEFAULT_PAGE_HEADER.showLanguageSwitcher),
    showColorScheme: asBoolean(input.showColorScheme, DEFAULT_PAGE_HEADER.showColorScheme),
    showColorSchemeSystem: asBoolean(input.showColorSchemeSystem, DEFAULT_PAGE_HEADER.showColorSchemeSystem),
    showAuthLinks: asBoolean(input.showAuthLinks, DEFAULT_PAGE_HEADER.showAuthLinks),
    blocks: parseHeaderBlocks(input.blocks),
  };
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
