// SPDX-License-Identifier: MIT

import {
  DEFAULT_MENU_DESIGN,
  parseMenuDesign,
  type MenuDesign,
} from "./menus-db.js";

/**
 * Menu design presets: one-click starting points shown in the menu designer's
 * design panel. A handful ship built-in; plugins and themes may contribute
 * more through the `menu.design.presets` filter (never stored — they ship
 * with the extension and disappear cleanly when it is removed, exactly like
 * `header.templates`).
 */

const TEMPLATE_ID = /^[a-z0-9][a-z0-9._-]{0,63}:[a-z0-9][a-z0-9._-]{0,63}$/i;

export interface MenuDesignPresetMeta {
  id: string;
  name: string;
  source?: string;
  description?: string;
  design: MenuDesign;
}

export const BUILT_IN_MENU_DESIGN_PRESETS: MenuDesignPresetMeta[] = [
  {
    id: "core:horizontal",
    name: "Simple horizontal",
    source: "core",
    description: "A single-row navigation bar with hover dropdowns for nested items.",
    design: { ...DEFAULT_MENU_DESIGN, presetId: "core:horizontal" },
  },
  {
    id: "core:mega",
    name: "Dropdown mega menu",
    source: "core",
    description: "A horizontal bar whose top-level items open a multi-column mega panel.",
    design: {
      ...DEFAULT_MENU_DESIGN,
      layout: "mega",
      activation: "click",
      presetId: "core:mega",
    },
  },
  {
    id: "core:footer",
    name: "Footer links",
    source: "core",
    description: "A flat list of links suited to a footer column, no dropdowns.",
    design: {
      ...DEFAULT_MENU_DESIGN,
      layout: "footer",
      maxDepth: 1,
      presetId: "core:footer",
    },
  },
];

function normalize(raw: unknown): MenuDesignPresetMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== "string" || !TEMPLATE_ID.test(p.id)) return null;
  if (typeof p.name !== "string" || !p.name.trim()) return null;
  if (!p.design || typeof p.design !== "object") return null;
  return {
    id: p.id,
    name: p.name.trim().slice(0, 120),
    source: typeof p.source === "string" ? p.source : p.id.split(":")[0],
    description: typeof p.description === "string" ? p.description.slice(0, 240) : undefined,
    design: parseMenuDesign(p.design),
  };
}

export async function listMenuDesignPresets(siteId: string): Promise<MenuDesignPresetMeta[]> {
  const out = [...BUILT_IN_MENU_DESIGN_PRESETS];
  try {
    const { ensurePluginRuntime, getRuntimeHooks } = await import("./plugin-runtime.js");
    await ensurePluginRuntime();
    const hooks = getRuntimeHooks();
    if (!hooks.has("menu.design.presets")) return out;
    const raw = await hooks.applyFilter(
      "menu.design.presets",
      [] as unknown[],
      { siteId },
      { siteId, source: "http" },
    );
    if (!Array.isArray(raw)) return out;
    const seen = new Set(out.map((p) => p.id));
    for (const candidate of raw) {
      const preset = normalize(candidate);
      if (!preset || seen.has(preset.id)) continue;
      seen.add(preset.id);
      out.push(preset);
    }
  } catch {
    // A plugin filter failing must never break the design panel.
  }
  return out;
}
