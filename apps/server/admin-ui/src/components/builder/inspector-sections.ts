// SPDX-License-Identifier: MIT
import {
  INSPECTOR_FIELDS,
  INSPECTOR_SECTIONS,
  normalizeDeviceList,
  parseBlockStyle,
  resolveInspectorSupports,
  type BlockStyle,
  type InspectorField,
  type InspectorSection,
} from "@justflows/blocks";
import type { BlockCatalogEntry, BlockNode } from "./types";

export type InspectorSections = Record<InspectorSection, boolean> & {
  /** Whether a single spacing/size/appearance/colors field shows. */
  field: (name: InspectorField) => boolean;
};

type LayoutSection = keyof typeof INSPECTOR_FIELDS;

/** Whether the block already stores a value that the section edits. */
function sectionInUse(section: InspectorSection, block: BlockNode, style: BlockStyle, curatedVars: Set<string>): boolean {
  const p = block.props;
  switch (section) {
    case "themeVariables":
      return Object.keys(style.vars).some((name) => !curatedVars.has(name));
    case "animation":
      return p.animation !== undefined && p.animation !== null;
    case "advanced":
      return Boolean(
        (typeof p.className === "string" && p.className.trim()) ||
          (typeof p.css === "string" && p.css.trim()) ||
          (normalizeDeviceList(p.devices) ?? []).length > 0,
      );
    default:
      return INSPECTOR_FIELDS[section].some((key) => Boolean(style[key]));
  }
}

/**
 * Which generic sections and fields the inspector shows for a block.
 *
 * The block's catalog entry decides. A switched-off section or hidden field
 * still shows while the block holds a value for it, so content saved before
 * the switch (or by the JSON panel, MCP, or an import) can always be seen and
 * cleared.
 */
export function inspectorSections(
  block: BlockNode,
  catalogEntry: BlockCatalogEntry | undefined,
  curatedVars: Set<string> = new Set(),
): InspectorSections {
  const supports = resolveInspectorSupports({ type: block.type, inspector: catalogEntry?.inspector });
  /** A schema-owned scalar style (such as a widget variant) cannot also store generic style data. */
  if (catalogEntry?.schema?.style) {
    supports.themeVariables = false;
    for (const section of Object.keys(INSPECTOR_FIELDS) as LayoutSection[]) supports[section] = false;
  }
  const style = parseBlockStyle(block.props.style);
  const hidden = new Set<InspectorField>(supports.hideFields);
  /** An image caption is text on the figure, so its alignment and colour become useful. */
  if (block.type === "core.image" && typeof block.props.caption === "string" && block.props.caption.trim()) {
    hidden.delete("textAlign");
    hidden.delete("textColor");
  }
  /** Accent colours have a native consumer only on a checklist's checkboxes. */
  if (block.type === "core.list" && block.props.listStyle !== "checklist") hidden.add("accent");
  const sectionOf = new Map<InspectorField, LayoutSection>();
  for (const [section, names] of Object.entries(INSPECTOR_FIELDS) as [LayoutSection, readonly InspectorField[]][]) {
    for (const name of names) sectionOf.set(name, section);
  }

  const field = (name: InspectorField): boolean => {
    if (style[name]) return true;
    const section = sectionOf.get(name);
    return Boolean(section && supports[section]) && !hidden.has(name);
  };

  const out = { field } as InspectorSections;
  for (const section of INSPECTOR_SECTIONS) {
    out[section] = section in INSPECTOR_FIELDS
      ? INSPECTOR_FIELDS[section as LayoutSection].some(field)
      : section === "themeVariables"
        ? supports.themeVariables
        : supports[section] || sectionInUse(section, block, style, curatedVars);
  }
  return out;
}
