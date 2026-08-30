// SPDX-License-Identifier: MIT

import { parsePageHeader, type PageHeaderConfig } from "./page-header.js";

/**
 * Header designs contributed by plugins and themes through the
 * `header.templates` filter. These are registered in code, never stored — they
 * ship with the extension, stay in sync with it, and disappear cleanly when it
 * is removed. A page that referenced an uninstalled template falls back to the
 * site default (see `resolveHeaderConfig`).
 *
 * A site owner who wants to keep and edit a plugin design "instantiates" it:
 * the `build()` output is copied into their header library as a normal entry.
 */

const TEMPLATE_ID = /^[a-z0-9][a-z0-9._-]{0,63}:[a-z0-9][a-z0-9._-]{0,63}$/i;

export interface HeaderTemplateMeta {
  id: string;
  name: string;
  source?: string;
  description?: string;
}

interface HeaderTemplateRuntime extends HeaderTemplateMeta {
  build: (ctx: {
    siteId: string;
    locale: string;
    defaultLocale: string;
  }) => unknown | Promise<unknown>;
}

function normalize(raw: unknown): HeaderTemplateRuntime | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== "string" || !TEMPLATE_ID.test(t.id)) return null;
  if (typeof t.name !== "string" || !t.name.trim()) return null;
  if (typeof t.build !== "function") return null;
  return {
    id: t.id,
    name: t.name.trim().slice(0, 120),
    source: typeof t.source === "string" ? t.source : t.id.split(":")[0],
    description: typeof t.description === "string" ? t.description.slice(0, 240) : undefined,
    build: t.build as HeaderTemplateRuntime["build"],
  };
}

async function collect(
  siteId: string,
  locale: string,
  defaultLocale: string,
): Promise<HeaderTemplateRuntime[]> {
  try {
    const { ensurePluginRuntime, getRuntimeHooks } = await import("./plugin-runtime.js");
    await ensurePluginRuntime();
    const hooks = getRuntimeHooks();
    if (!hooks.has("header.templates")) return [];
    const raw = await hooks.applyFilter(
      "header.templates",
      [] as unknown[],
      { siteId, locale, defaultLocale },
      { siteId, source: "http" },
    );
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: HeaderTemplateRuntime[] = [];
    for (const candidate of raw) {
      const t = normalize(candidate);
      if (!t || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
    return out;
  } catch {
    return [];
  }
}

/** Metadata for the header picker — no `build()` call. */
export async function listHeaderTemplates(
  siteId: string,
  locale: string,
  defaultLocale: string,
): Promise<HeaderTemplateMeta[]> {
  const list = await collect(siteId, locale, defaultLocale);
  return list.map(({ id, name, source, description }) => ({ id, name, source, description }));
}

/**
 * Run a plugin template's `build()` and sanitise the result into a real
 * `PageHeaderConfig`. Returns `null` when the id is unknown or `build()` throws.
 */
export async function buildHeaderTemplate(
  siteId: string,
  locale: string,
  defaultLocale: string,
  id: string,
): Promise<PageHeaderConfig | null> {
  const list = await collect(siteId, locale, defaultLocale);
  const template = list.find((t) => t.id === id);
  if (!template) return null;
  try {
    const config = await template.build({ siteId, locale, defaultLocale });
    return parsePageHeader(config);
  } catch {
    return null;
  }
}
