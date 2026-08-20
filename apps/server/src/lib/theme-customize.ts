import { getSiteSetting, setSiteSetting, deleteSiteSetting, getSiteId } from "./site-settings.js";
import { loadThemeStyles } from "./theme-files.js";
import { getActiveTheme, themeInstalledPath } from "./themes-db.js";
import { sanitizeCustomCss } from "./safe-css.js";
import { sanitizeFaviconUrl } from "./favicon.js";

export type CustomizeControlType = "color" | "font" | "text" | "image" | "range" | "code" | "select";

export interface CustomizeControl {
  label: string;
  type: CustomizeControlType;
  default: string | number;
  min?: number;
  max?: number;
  unit?: string;
  options?: { label: string; value: string }[];
  description?: string;
}

export interface CustomizeSection {
  label: string;
  controls: Record<string, CustomizeControl>;
}

export const FONT_PRESETS = [
  { label: "System UI", value: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif" },
  { label: "Inter", value: '"Inter", system-ui, sans-serif' },
  { label: "Georgia (serif)", value: 'Georgia, "Times New Roman", serif' },
  { label: "Merriweather", value: '"Merriweather", Georgia, serif' },
  { label: "Monospace", value: 'ui-monospace, "Cascadia Code", Consolas, monospace' },
];

/** Built-in customization schema for Justflows default theme. */
export const THEME_CUSTOMIZE_SCHEMA: Record<string, CustomizeSection> = {
  identity: {
    label: "Site Identity",
    controls: {
      siteTitle: { label: "Site title", type: "text", default: "" },
      tagline: { label: "Tagline", type: "text", default: "" },
      logoUrl: { label: "Logo", type: "image", default: "" },
    },
  },
  colors: {
    label: "Colors",
    controls: {
      "--color-primary": { label: "Primary", type: "color", default: "#3b82f6" },
      "--color-primary-hover": { label: "Primary hover", type: "color", default: "#2563eb" },
      "--color-bg": { label: "Background", type: "color", default: "#ffffff" },
      "--color-surface": { label: "Surface", type: "color", default: "#f8fafc" },
      "--color-text": { label: "Text", type: "color", default: "#0f172a" },
      "--color-muted": { label: "Muted text", type: "color", default: "#64748b" },
      "--color-border": { label: "Border", type: "color", default: "#e2e8f0" },
    },
  },
  typography: {
    label: "Typography",
    controls: {
      "--font-sans": {
        label: "Body font",
        type: "font",
        default: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        options: FONT_PRESETS,
      },
      "--font-mono": {
        label: "Code font",
        type: "font",
        default: 'ui-monospace, "Cascadia Code", Consolas, monospace',
        options: FONT_PRESETS,
      },
      baseFontSize: { label: "Base font size", type: "range", default: 16, min: 14, max: 20, unit: "px" },
    },
  },
  layout: {
    label: "Layout",
    controls: {
      contentWidth: { label: "Content width", type: "range", default: 720, min: 560, max: 1200, unit: "px" },
    },
  },
  navigation: {
    label: "Navigation",
    controls: {
      headerMenu: {
        label: "Header menu",
        type: "select",
        default: "primary",
        options: [{ label: "Primary Menu", value: "primary" }],
      },
      footerMenu: {
        label: "Footer menu",
        type: "select",
        default: "",
        options: [{ label: "None", value: "" }],
      },
    },
  },
  advanced: {
    label: "Additional CSS",
    controls: {
      additionalCss: { label: "Custom CSS", type: "code", default: "" },
    },
  },
};

export interface ThemeMods {
  identity?: Record<string, string>;
  colors?: Record<string, string>;
  typography?: Record<string, string | number>;
  layout?: Record<string, string | number>;
  navigation?: Record<string, string>;
  advanced?: Record<string, string>;
}

export const DEFAULT_THEME_CSS_VARS: Record<string, string> = {
  "--color-primary": "#3b82f6",
  "--color-primary-hover": "#2563eb",
  "--color-bg": "#ffffff",
  "--color-surface": "#f8fafc",
  "--color-text": "#0f172a",
  "--color-muted": "#64748b",
  "--color-border": "#e2e8f0",
  "--font-sans": "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  "--font-mono": 'ui-monospace, "Cascadia Code", Consolas, monospace',
  "--max-width": "720px",
  "--max-width-wide": "1100px",
};

function modsKey(themeId: string, draft = false): string {
  return draft ? `theme_mods_draft.${themeId}` : `theme_mods.${themeId}`;
}

export function defaultModsFromSchema(): ThemeMods {
  const mods: ThemeMods = {};
  for (const [sectionKey, section] of Object.entries(THEME_CUSTOMIZE_SCHEMA)) {
    mods[sectionKey as keyof ThemeMods] = {};
    for (const [controlKey, control] of Object.entries(section.controls)) {
      (mods[sectionKey as keyof ThemeMods] as Record<string, unknown>)[controlKey] = control.default;
    }
  }
  return mods;
}

export function mergeMods(base: ThemeMods, patch: ThemeMods): ThemeMods {
  const merged: ThemeMods = {
    identity: { ...base.identity, ...patch.identity },
    colors: { ...base.colors, ...patch.colors },
    typography: { ...base.typography, ...patch.typography },
    layout: { ...base.layout, ...patch.layout },
    navigation: { ...base.navigation, ...patch.navigation },
    advanced: { ...base.advanced, ...patch.advanced },
  };

  if (merged.advanced?.additionalCss !== undefined) {
    merged.advanced.additionalCss = sanitizeCustomCss(merged.advanced.additionalCss);
  }

  return merged;
}

/** Convert user mods into CSS custom properties for :root. */
export function modsToCssVariables(
  themeVars: Record<string, string>,
  mods: ThemeMods,
): Record<string, string> {
  const vars = { ...DEFAULT_THEME_CSS_VARS, ...themeVars };

  for (const [key, value] of Object.entries(mods.colors ?? {})) {
    if (typeof value === "string" && value) vars[key] = value;
  }
  for (const [key, value] of Object.entries(mods.typography ?? {})) {
    if (key.startsWith("--") && typeof value === "string" && value) vars[key] = value;
  }
  if (mods.typography?.baseFontSize != null) {
    vars["--base-font-size"] = `${mods.typography.baseFontSize}px`;
  }
  if (mods.layout?.contentWidth != null) {
    vars["--max-width"] = `${mods.layout.contentWidth}px`;
  }

  return vars;
}

export function buildThemeStylesheet(
  vars: Record<string, string>,
  additionalCss = "",
): string {
  const declarations = Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");

  const baseSize = vars["--base-font-size"] ?? "16px";
  let css = `:root {\n${declarations}\n}\n\nhtml { font-size: ${baseSize}; }\n`;

  if (additionalCss.trim()) {
    css += `\n/* Custom CSS */\n${additionalCss.trim()}\n`;
  }

  return css;
}

export async function getThemeMods(themeId: string, draft = false): Promise<ThemeMods | null> {
  const siteId = await getSiteId();
  if (!siteId) return null;
  return getSiteSetting<ThemeMods>(siteId, modsKey(themeId, draft));
}

export async function saveThemeMods(themeId: string, mods: ThemeMods, draft = false): Promise<void> {
  const siteId = await getSiteId();
  if (!siteId) throw new Error("No site found");
  const storedIcon = await getSiteSetting<string>(siteId, "favicon_url");
  const fromMods = sanitizeFaviconUrl(mods.identity?.faviconUrl);
  if (typeof storedIcon !== "string" && fromMods) {
    await setSiteSetting(siteId, "favicon_url", fromMods);
  }
  await setSiteSetting(siteId, modsKey(themeId, draft), stripStoredSiteIdentity(mods));
}

/** Site title, tagline, and site icon live outside theme mods. Theme mods keep the logo. */
export function stripStoredSiteIdentity(mods: ThemeMods): ThemeMods {
  return {
    ...mods,
    identity: { logoUrl: mods.identity?.logoUrl ?? "" },
  };
}

export async function resolveFaviconUrl(mods?: ThemeMods): Promise<string> {
  const siteId = await getSiteId();
  if (siteId) {
    const stored = await getSiteSetting<string>(siteId, "favicon_url");
    if (typeof stored === "string") return sanitizeFaviconUrl(stored);
    if (!mods) {
      const theme = await getActiveTheme(siteId);
      if (theme) mods = (await getThemeMods(theme.theme_id, false)) ?? undefined;
    }
  }
  return sanitizeFaviconUrl(mods?.identity?.faviconUrl);
}

export async function clearThemeDraft(themeId: string): Promise<void> {
  const siteId = await getSiteId();
  if (!siteId) return;
  await deleteSiteSetting(siteId, modsKey(themeId, true));
}

export async function getEffectiveThemeCss(preview = false): Promise<string> {
  const siteId = await getSiteId();
  const theme = siteId ? await getActiveTheme(siteId) : null;
  const themeId = theme?.theme_id ?? "justflows.default";
  const installedPath = themeInstalledPath(theme);

  if (!siteId) {
    const base = buildThemeStylesheet(DEFAULT_THEME_CSS_VARS);
    const themeStyles = loadThemeStyles(themeId, installedPath);
    return themeStyles ? `${base}\n\n/* Theme styles */\n${themeStyles}` : base;
  }

  const themeVars = theme?.css_variables ?? {};

  const defaults = defaultModsFromSchema();
  const published = (await getThemeMods(themeId, false)) ?? {};
  const draft = preview ? ((await getThemeMods(themeId, true)) ?? {}) : {};

  const mods = mergeMods(mergeMods(defaults, published), draft);
  const vars = modsToCssVariables(themeVars, mods);
  const additionalCss = sanitizeCustomCss(mods.advanced?.additionalCss ?? "");

  const base = buildThemeStylesheet(vars, additionalCss);
  const themeStyles = loadThemeStyles(themeId, installedPath);
  return themeStyles ? `${base}\n\n/* Theme styles */\n${themeStyles}` : base;
}

export async function getSiteIdentity(
  mods?: ThemeMods,
  opts?: { preview?: boolean },
): Promise<{
  siteTitle: string;
  tagline: string;
  logoUrl: string;
  faviconUrl: string;
}> {
  const db = await import("./db.js").then((m) => m.getDb());
  const rows = await db.query<{ name: string; description: string | null }>(
    "SELECT name, description FROM sites LIMIT 1",
  );
  const site = rows[0];
  const siteTitle = site?.name?.trim() || "My Site";
  const tagline = site?.description ?? "";
  const logoUrl = mods?.identity?.logoUrl || "";
  const faviconUrl = await resolveFaviconUrl(mods);

  if (opts?.preview) {
    return {
      siteTitle: mods?.identity?.siteTitle?.trim() || siteTitle,
      tagline: mods?.identity?.tagline || tagline,
      logoUrl,
      faviconUrl,
    };
  }

  return { siteTitle, tagline, logoUrl, faviconUrl };
}

/** Resolve menu slug assignments from theme mods (empty string = none). */
export function getNavigationMenuSlugs(mods: ThemeMods): {
  header: string | null;
  footer: string | null;
} {
  const header = mods.navigation?.headerMenu?.trim();
  const footer = mods.navigation?.footerMenu?.trim();
  return {
    header: header ? header : null,
    footer: footer ? footer : null,
  };
}

/** Inject live menu options into the navigation section of the customize schema. */
export async function getCustomizeSchema(siteId: string): Promise<Record<string, CustomizeSection>> {
  const schema = structuredClone(THEME_CUSTOMIZE_SCHEMA);
  const { listMenus } = await import("./menus-db.js");
  const menus = await listMenus(siteId);
  const menuOptions = [
    { label: "— None —", value: "" },
    ...menus.map((menu) => ({ label: `${menu.name} (${menu.slug})`, value: menu.slug })),
  ];

  const navigation = schema.navigation;
  if (navigation) {
    for (const key of ["headerMenu", "footerMenu"] as const) {
      const control = navigation.controls[key];
      if (control) control.options = menuOptions;
    }
  }

  return schema;
}

export async function publishThemeMods(themeId: string, mods: ThemeMods): Promise<void> {
  const siteId = await getSiteId();
  if (!siteId) throw new Error("No site found");
  await saveThemeMods(themeId, stripStoredSiteIdentity(mods), false);
  await clearThemeDraft(themeId);
}
