// SPDX-License-Identifier: MIT

/**
 * The generic settings sections the page builder can show under a block's own
 * fields. A block turns sections off when they make no sense for it, so the
 * inspector only offers what actually changes the block.
 *
 * - `themeVariables`: the "All theme variables" list under Theme styling. The
 *   theme's curated controls for a block type always show; they were picked
 *   for that type on purpose.
 * - `animation`: entrance, hover and tap motion.
 * - `spacing`: padding and margins.
 * - `size`: width preset, self-alignment, min height, max width/height.
 * - `appearance`: text alignment, corner radius, shadow.
 * - `colors`: background, text and accent colour, opacity.
 * - `advanced`: extra CSS classes, scoped CSS, and device visibility.
 */
export const INSPECTOR_SECTIONS = [
  "themeVariables",
  "animation",
  "spacing",
  "size",
  "appearance",
  "colors",
  "advanced",
] as const;

export type InspectorSection = (typeof INSPECTOR_SECTIONS)[number];

/** The single `style` fields inside the spacing, size, appearance and colors sections. */
export const INSPECTOR_FIELDS = {
  spacing: ["padTop", "padBottom", "padX", "marginTop", "marginBottom"],
  size: ["width", "alignSelf", "minHeight", "maxWidth", "maxHeight"],
  appearance: ["textAlign", "radius", "shadow"],
  colors: ["background", "textColor", "accent", "opacity"],
} as const;

export type InspectorField = (typeof INSPECTOR_FIELDS)[keyof typeof INSPECTOR_FIELDS][number];

const ALL_FIELDS = new Set<string>(Object.values(INSPECTOR_FIELDS).flat());

/**
 * Per-block switches. A missing section key falls back to the default.
 * `hideFields` drops single fields from a section that otherwise shows,
 * typically because the block has its own field for the same thing.
 */
export type BlockInspectorSupports = Partial<Record<InspectorSection, boolean>> & {
  hideFields?: InspectorField[];
};

export type ResolvedInspectorSupports = Record<InspectorSection, boolean> & {
  hideFields: InspectorField[];
};

/** What a block gets when it says nothing. `themeVariables` is opt-in: it is long and mostly noise on small blocks. */
export const DEFAULT_INSPECTOR_SUPPORTS: Record<InspectorSection, boolean> = {
  themeVariables: false,
  animation: true,
  spacing: true,
  size: true,
  appearance: true,
  colors: true,
  advanced: true,
};

/** Text blocks keep text alignment, colours and spacing, without box decoration or viewport sizing. */
const TEXT: BlockInspectorSupports = { hideFields: ["minHeight", "maxHeight", "radius", "shadow", "accent"] };

/** Ordinary boxes have no native accent-colour consumer. Themes can supply curated controls. */
const BOX: BlockInspectorSupports = { hideFields: ["accent"] };

/** Flex/grid wrappers position children through their own layout controls, rather than text alignment. */
const LAYOUT: BlockInspectorSupports = { hideFields: ["textAlign", "accent"] };

/**
 * Every shipped core block is reviewed here. Plugin blocks retain the public
 * defaults and can declare their own inspector support. Theme variables stay
 * curated; a site's complete token catalog is not a per-block settings list.
 */
export const CORE_INSPECTOR_SUPPORTS: Record<string, BlockInspectorSupports> = {
  "core.paragraph": TEXT,
  "core.heading": TEXT,
  "core.quote": BOX,
  "core.link-list": BOX,
  "core.html": BOX,
  "core.code": { hideFields: ["textAlign", "accent"] },
  "core.embed": { hideFields: ["textAlign", "textColor", "accent"] },

  /** Own Padding and Alignment; custom background colours remain useful alongside named palettes. */
  "core.section": { hideFields: ["padTop", "padBottom", "textAlign", "accent"] },
  "core.container": { hideFields: ["width", "accent"] },
  "core.group": BOX,
  "core.columns": LAYOUT,
  "core.column": BOX,
  "core.grid": LAYOUT,
  "core.features": LAYOUT,
  "core.cta": BOX,
  "core.media-text": BOX,
  "core.hero": { hideFields: ["textAlign", "accent"] },
  /** Own Min height and Alignment. */
  "core.cover": { hideFields: ["minHeight", "textAlign", "accent"] },
  /** Own Padding, Radius, Shadow and Alignment. */
  "core.card": { hideFields: ["padTop", "padBottom", "padX", "radius", "shadow", "textAlign", "accent"] },

  /** Replaced before rendering, so presentation on this placeholder never reaches the page. */
  "core.reusable": { animation: false, spacing: false, size: false, appearance: false, colors: false, advanced: false },
  /** Own Height. Advanced retains device visibility and explicit CSS overrides. */
  "core.spacer": { animation: false, spacing: false, size: false, appearance: false, colors: false },
  "core.divider": { appearance: false, hideFields: ["padTop", "padBottom", "padX", "minHeight", "maxHeight", "textColor", "accent"] },
  /** Own pixel dimensions; caption controls are enabled by the editor only when a caption exists. */
  "core.image": { hideFields: ["padTop", "padBottom", "padX", "minHeight", "textAlign", "background", "textColor", "accent"] },
  /** Playback styling applies to the outer figure, not the native media player. Caption alignment remains useful. */
  "core.video": { hideFields: ["minHeight", "maxHeight", "radius", "accent"] },
  "core.audio": { hideFields: ["minHeight", "maxHeight", "radius", "accent"] },
  "core.file": { hideFields: ["minHeight", "maxHeight", "accent"] },
  "core.button": { hideFields: ["minHeight", "maxHeight", "textAlign", "accent"] },
  "core.buttons": LAYOUT,
  /** Own Size and Colour; the inline SVG does not inherit root text colour. */
  "core.icon": { hideFields: ["width", "minHeight", "maxHeight", "textAlign", "textColor", "accent"] },

  /** Checkbox accent is meaningful for checklists; the editor hides it for other list styles. */
  "core.list": {},
  "core.list-item": { animation: false, size: false, hideFields: ["accent"] },
  "core.table": { hideFields: ["textAlign", "minHeight", "accent"] },
  "core.details": BOX,
  "core.accordion": LAYOUT,
  "core.callout": LAYOUT,
  "core.tabs": LAYOUT,
  "core.tab": { animation: false, size: false, hideFields: ["accent"] },

  /** The logo's own Width sizes the image inside the site-block wrapper. */
  "core.site-logo": { hideFields: ["minHeight", "maxHeight", "textColor", "accent"] },
  "core.site-title": TEXT,
  "core.site-tagline": TEXT,
  "core.navigation": LAYOUT,
  "core.breadcrumbs": LAYOUT,
  "core.social-links": LAYOUT,
  "core.table-of-contents": BOX,
  "core.content-query": BOX,
  "core.search": BOX,
  "core.account": BOX,
  "core.auth-form": BOX,
  /** Own Alignment, Size and Corners. Theme-specific variables must be curated for this type. */
  "core.color-scheme": { hideFields: ["textAlign", "radius", "minHeight", "maxHeight", "accent"] },
  "core.language-switcher": { hideFields: ["textAlign", "minHeight", "maxHeight", "accent"] },
  "core.auth-links": { hideFields: ["textAlign", "minHeight", "maxHeight", "accent"] },
};

/** The full switch set for a block: defaults, then the core table, then the definition's own `inspector`. */
export function resolveInspectorSupports(def: {
  type: string;
  inspector?: BlockInspectorSupports;
}): ResolvedInspectorSupports {
  const core = CORE_INSPECTOR_SUPPORTS[def.type] ?? {};
  const own = def.inspector ?? {};
  const out: ResolvedInspectorSupports = { ...DEFAULT_INSPECTOR_SUPPORTS, hideFields: [] };
  for (const key of INSPECTOR_SECTIONS) {
    const value = typeof own[key] === "boolean" ? own[key] : core[key];
    if (typeof value === "boolean") out[key] = value;
  }
  const hide = Array.isArray(own.hideFields) ? own.hideFields : core.hideFields ?? [];
  out.hideFields = [...new Set(hide.filter((name) => ALL_FIELDS.has(name)))];
  return out;
}
