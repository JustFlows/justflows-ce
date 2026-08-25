export const PAGE_HEADER_FIELD = "jfHeader";
export const HEADER_SELECTED_ID = "__header__";

export type HeaderLayout = "logo-left" | "logo-center" | "split";
export type HeaderMenuMode = "inherit" | "menu" | "none";

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
    id: typeof n.id === "string" && n.id ? n.id : crypto.randomUUID(),
    type: n.type,
    version: typeof n.version === "number" ? n.version : 1,
    props: n.props && typeof n.props === "object" && !Array.isArray(n.props)
      ? { ...(n.props as Record<string, unknown>) }
      : {},
    children,
  };
}

export function headerFromFields(fields: Record<string, unknown> | null | undefined): PageHeaderConfig {
  return parsePageHeader(fields?.[PAGE_HEADER_FIELD]);
}

export function fieldsWithHeader(
  fields: Record<string, unknown> | null | undefined,
  header: PageHeaderConfig,
): Record<string, unknown> {
  return { ...(fields ?? {}), [PAGE_HEADER_FIELD]: header };
}
