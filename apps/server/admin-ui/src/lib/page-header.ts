import { uid } from "./uid";

/** @deprecated headers now live in the site header library; kept for one release. */
export const PAGE_HEADER_FIELD = "jfHeader";
export const HEADER_SELECTED_ID = "__header__";

/** Which site-header-library entry a page renders (see {@link headerRefFromFields}). */
export const PAGE_HEADER_REF_FIELD = "jfHeaderRef";
export const SITE_DEFAULT_HEADER_REF = "__default__";
export const NO_HEADER_REF = "__none__";

export type HeaderLayout = "logo-left" | "logo-center" | "split";
export type HeaderMenuMode = "inherit" | "menu" | "none";
export type HeaderLanguageSwitcherStyle = "locale-full" | "locale-short" | "flags" | "flag-locale" | "flag-country";

export interface HeaderBlockNode {
  id: string;
  type: string;
  version: number;
  props: Record<string, unknown>;
  children?: HeaderBlockNode[];
}

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
  blocks: HeaderBlockNode[];
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

export function parsePageHeader(raw: unknown): PageHeaderConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_PAGE_HEADER };
  }
  const input = raw as Record<string, unknown>;
  const menuMode = input.menuMode;
  const layout = input.layout;
  const languageSwitcherStyle = input.languageSwitcherStyle;
  return {
    visible: input.visible !== false,
    menuMode: menuMode === "menu" || menuMode === "none" ? menuMode : "inherit",
    menuSlug: typeof input.menuSlug === "string" ? input.menuSlug : "",
    showLogo: input.showLogo !== false,
    showTitle: input.showTitle !== false,
    layout: layout === "logo-center" || layout === "split" ? layout : "logo-left",
    sticky: input.sticky !== false,
    background: typeof input.background === "string" ? input.background : "",
    showLanguageSwitcher: input.showLanguageSwitcher !== false,
    languageSwitcherStyle: languageSwitcherStyle === "locale-full" || languageSwitcherStyle === "flags" || languageSwitcherStyle === "flag-locale" || languageSwitcherStyle === "flag-country"
      ? languageSwitcherStyle
      : "locale-short",
    showColorScheme: input.showColorScheme === true,
    showColorSchemeSystem: input.showColorSchemeSystem === true,
    showAuthLinks: input.showAuthLinks === true,
    blocks: parseHeaderBlocks(input.blocks),
  };
}

const MAX_HEADER_BLOCKS = 40;

function parseHeaderBlocks(raw: unknown): HeaderBlockNode[] {
  if (!Array.isArray(raw)) return [];
  const out: HeaderBlockNode[] = [];
  for (const item of raw.slice(0, MAX_HEADER_BLOCKS)) {
    const node = parseHeaderBlock(item);
    if (node) out.push(node);
  }
  return out;
}

function parseHeaderBlock(raw: unknown): HeaderBlockNode | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const n = raw as Record<string, unknown>;
  if (typeof n.type !== "string" || !n.type.trim()) return null;
  const children = Array.isArray(n.children)
    ? n.children.map(parseHeaderBlock).filter((child): child is HeaderBlockNode => child !== null)
    : undefined;
  return {
    id: typeof n.id === "string" && n.id ? n.id : uid(),
    type: n.type,
    version: typeof n.version === "number" ? n.version : 1,
    props: n.props && typeof n.props === "object" && !Array.isArray(n.props)
      ? { ...(n.props as Record<string, unknown>) }
      : {},
    children,
  };
}

/** @deprecated */
export function headerFromFields(fields: Record<string, unknown> | null | undefined): PageHeaderConfig {
  return parsePageHeader(fields?.[PAGE_HEADER_FIELD]);
}

/** @deprecated */
export function fieldsWithHeader(
  fields: Record<string, unknown> | null | undefined,
  header: PageHeaderConfig,
): Record<string, unknown> {
  return { ...(fields ?? {}), [PAGE_HEADER_FIELD]: header };
}

/** The library entry ref stored on a page, or the site default when unset. */
export function headerRefFromFields(fields: Record<string, unknown> | null | undefined): string {
  const raw = fields?.[PAGE_HEADER_REF_FIELD];
  return typeof raw === "string" && raw.trim() ? raw.trim() : SITE_DEFAULT_HEADER_REF;
}

/** Store a header ref on a page's fields; the site default is stored as "no key". */
export function fieldsWithHeaderRef(
  fields: Record<string, unknown> | null | undefined,
  ref: string,
): Record<string, unknown> {
  const next = { ...(fields ?? {}) };
  if (!ref || ref === SITE_DEFAULT_HEADER_REF) {
    delete next[PAGE_HEADER_REF_FIELD];
  } else {
    next[PAGE_HEADER_REF_FIELD] = ref;
  }
  return next;
}

const HEADER_KEYS: (keyof PageHeaderConfig)[] = [
  "visible", "menuMode", "menuSlug", "showLogo", "showTitle", "layout", "sticky",
  "background", "showLanguageSwitcher", "languageSwitcherStyle", "showColorScheme",
  "showColorSchemeSystem", "showAuthLinks", "blocks",
];

/** Overlay a sparse per-locale patch onto a base header config. */
export function mergePageHeaderClient(
  base: PageHeaderConfig,
  patch: Partial<PageHeaderConfig> | undefined,
): PageHeaderConfig {
  return { ...base, ...(patch ?? {}) };
}

/** The subset of `next` that differs from `base` — what to persist as a locale override. */
export function diffPageHeader(
  base: PageHeaderConfig,
  next: PageHeaderConfig,
): Partial<PageHeaderConfig> {
  const patch: Partial<PageHeaderConfig> = {};
  for (const key of HEADER_KEYS) {
    const differs =
      key === "blocks"
        ? JSON.stringify(base.blocks) !== JSON.stringify(next.blocks)
        : base[key] !== next[key];
    if (differs) (patch as Record<string, unknown>)[key] = next[key];
  }
  return patch;
}

export interface SiteHeaderEntryDTO {
  id: string;
  name: string;
  base: PageHeaderConfig;
  overrides: Record<string, Partial<PageHeaderConfig>>;
  updatedAt?: string;
}

export interface SiteHeaderLibraryDTO {
  version: 1;
  defaultId: string | null;
  entries: SiteHeaderEntryDTO[];
}

export interface SiteHeaderOptionDTO {
  id: string;
  name: string;
  isDefault: boolean;
}

/** A header design contributed by a plugin or theme (id is `pluginId:slug`). */
export interface HeaderTemplateOptionDTO {
  id: string;
  name: string;
  source?: string;
  description?: string;
}
