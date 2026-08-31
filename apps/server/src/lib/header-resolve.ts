// SPDX-License-Identifier: MIT

import { DEFAULT_PAGE_HEADER, parsePageHeader, type PageHeaderConfig } from "./page-header.js";
import {
  headerConfigForLocale,
  resolveHeaderEntry,
  type SiteHeaderLibrary,
} from "./site-header.js";
import { buildHeaderTemplate } from "./header-templates.js";
import { loadThemeDemoHeader } from "./theme-files.js";
import { getActiveTheme, themeInstalledPath } from "./themes-db.js";

/**
 * The header a page falls back to when the site header library has no default
 * entry: the active theme's `demo/header.json` merged over `DEFAULT_PAGE_HEADER`,
 * or plain `DEFAULT_PAGE_HEADER` when the theme ships none.
 */
async function themeDefaultHeaderConfig(siteId: string): Promise<PageHeaderConfig> {
  try {
    const theme = siteId ? await getActiveTheme(siteId) : null;
    const raw = theme ? loadThemeDemoHeader(theme.theme_id, themeInstalledPath(theme)) : null;
    if (raw) return parsePageHeader(raw);
  } catch {
    // fall through to the built-in default
  }
  return { ...DEFAULT_PAGE_HEADER, blocks: [] };
}

export interface HeaderResolveInput {
  siteId: string;
  library: SiteHeaderLibrary;
  /** `"__default__"` | `"__none__"` | `"<lib-uuid>"` | `"<pluginId>:<slug>"`. */
  ref: string;
  locale: string;
  defaultLocale: string;
  content?: { id?: string; type?: string };
}

/**
 * The header a page should render, in order of precedence:
 *
 *   1. `header.resolve` filter — a plugin takes over entirely.
 *   2. a plugin template ref (`"<pluginId>:<slug>"`) — `build()` its config.
 *   3. the site header library — the referenced entry, or the site default,
 *      merged with its locale override; `"__none__"` hides the header.
 *
 * Then the `header.config` filter runs for every path, so a plugin can adjust
 * any header. Every value coming back from a filter is re-parsed, so blocks are
 * capped and unsafe CSS is dropped no matter what a handler returns.
 */
export async function resolveHeaderConfig(input: HeaderResolveInput): Promise<PageHeaderConfig> {
  const { siteId, library, ref, locale, defaultLocale, content } = input;
  const { ensurePluginRuntime, getRuntimeHooks } = await import("./plugin-runtime.js");
  await ensurePluginRuntime();
  const hooks = getRuntimeHooks();
  const filterCtx = {
    siteId,
    locale,
    defaultLocale,
    ref,
    contentId: content?.id,
    contentType: content?.type,
  };

  let header: PageHeaderConfig | null = null;

  if (hooks.has("header.resolve")) {
    const taken = await hooks.applyFilter("header.resolve", null, filterCtx, {
      siteId,
      source: "http",
    });
    if (taken) header = parsePageHeader(taken);
  }

  if (!header && ref.includes(":")) {
    header = await buildHeaderTemplate(siteId, locale, defaultLocale, ref);
  }

  if (!header) {
    const { entry, hidden } = resolveHeaderEntry(library, ref);
    if (hidden) {
      header = { ...DEFAULT_PAGE_HEADER, blocks: [], visible: false };
    } else if (entry) {
      header = headerConfigForLocale(entry, locale);
    } else {
      // No library default — let the active theme supply the site header.
      header = await themeDefaultHeaderConfig(siteId);
    }
  }

  if (hooks.has("header.config")) {
    header = parsePageHeader(
      await hooks.applyFilter("header.config", header, filterCtx, { siteId, source: "http" }),
    );
  }

  return header;
}
