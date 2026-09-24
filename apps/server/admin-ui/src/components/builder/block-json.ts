import { translateEnglish, type Translate } from "../../i18n/translate";
import type { BlockDocument, BlockNode } from "./types";
import { reassignBlockIds, cloneBlocks } from "./block-tree";
import { uid } from "../../lib/uid";

export interface ThemeDesignExport {
  version: 1;
  type: "justflows/theme-design";
  blocks: BlockNode[];
  mods?: Record<string, unknown>;
}

function isBlockNode(value: unknown): value is BlockNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as BlockNode).id === "string" &&
    typeof (value as BlockNode).type === "string"
  );
}

/** Parse imported JSON into a block document (supports multiple formats). */
export function parseBlockDocumentJson(raw: unknown, t: Translate = translateEnglish): BlockDocument {
  if (Array.isArray(raw)) {
    if (!raw.every(isBlockNode)) throw new Error(t("ui.blockJson.invalidBlockArray"));
    return { version: 1, blocks: reassignBlockIds(cloneBlocks(raw)) };
  }

  if (typeof raw !== "object" || raw === null) {
    throw new Error(t("ui.blockJson.jsonMustBeABlockDocumentOrArrayOfBlocks"));
  }

  const obj = raw as Record<string, unknown>;

  if (obj.type === "justflows/theme-design" && Array.isArray(obj.blocks)) {
    if (!obj.blocks.every(isBlockNode)) throw new Error(t("ui.blockJson.invalidBlocksInThemeDesign"));
    return { version: 1, blocks: reassignBlockIds(cloneBlocks(obj.blocks as BlockNode[])) };
  }

  if (Array.isArray(obj.blocks)) {
    if (!obj.blocks.every(isBlockNode)) throw new Error(t("ui.blockJson.invalidBlocksArray"));
    return { version: 1, blocks: reassignBlockIds(cloneBlocks(obj.blocks as BlockNode[])) };
  }

  throw new Error(t("ui.blockJson.unrecognizedJSONFormatExpectedBlocksOrABlockArray"));
}

export function parseThemeDesignJson(raw: unknown, t: Translate = translateEnglish): { blocks: BlockDocument; mods?: Record<string, unknown> } {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(t("ui.blockJson.invalidJSON"));
  }
  const obj = raw as Record<string, unknown>;
  const blocks = parseBlockDocumentJson(raw, t);
  const mods = obj.mods && typeof obj.mods === "object" && !Array.isArray(obj.mods)
    ? (obj.mods as Record<string, unknown>)
    : undefined;
  return { blocks, mods };
}

export function buildThemeDesignExport(
  blocks: BlockDocument,
  mods?: Record<string, unknown>,
): ThemeDesignExport {
  return {
    version: 1,
    type: "justflows/theme-design",
    blocks: blocks.blocks,
    ...(mods ? { mods } : {}),
  };
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function readJsonFile(file: File, t: Translate = translateEnglish): Promise<unknown> {
  const text = await file.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(t("ui.blockJson.fileIsNotValidJSON"));
  }
}

/** The shape shown in the per-block JSON editor. */
export interface BlockNodeDraft {
  type: string;
  version: number;
  props: Record<string, unknown>;
  children?: BlockNode[];
}

export function normalizeBlockNode(raw: unknown): BlockNode | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const node = raw as Record<string, unknown>;
  if (typeof node.type !== "string" || !node.type) return null;
  return {
    id: typeof node.id === "string" && node.id ? node.id : uid(),
    type: node.type,
    version: typeof node.version === "number" && Number.isFinite(node.version) ? node.version : 1,
    props: raw && typeof node.props === "object" && node.props && !Array.isArray(node.props)
      ? (node.props as Record<string, unknown>)
      : {},
    ...(Array.isArray(node.children)
      ? { children: node.children.map(normalizeBlockNode).filter((n): n is BlockNode => n !== null) }
      : {}),
  };
}

/** Render one block as the JSON an editor edits. The id is a handle, not content. */
export function formatBlockNodeJson(block: BlockNode): string {
  const draft: BlockNodeDraft = {
    type: block.type,
    version: block.version,
    props: block.props,
    ...(block.children?.length ? { children: block.children } : {}),
  };
  return JSON.stringify(draft, null, 2);
}

/**
 * Parse edited JSON back into the selected block.
 *
 * The block keeps its own id whatever the JSON says: the id is what the canvas
 * selection, the undo history, and the block's scoped CSS all point at, so
 * letting an edit change it would silently orphan all three.
 */
export function parseBlockNodeJson(text: string, base: BlockNode, t: Translate = translateEnglish): BlockNode {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (err) {
    throw new Error(t("ui.blockJson.invalidJSON"));
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(t("ui.blockJson.expectedAnObjectWithATypeAndProps"));
  }

  const node = raw as Record<string, unknown>;
  if (typeof node.type !== "string" || !node.type) {
    throw new Error(t("ui.blockJson.typeIsRequiredAndMustBeABlockTypeString"));
  }
  if (node.props !== undefined && (typeof node.props !== "object" || node.props === null || Array.isArray(node.props))) {
    throw new Error(t("ui.blockJson.propsMustBeAnObject"));
  }
  if (node.children !== undefined && !Array.isArray(node.children)) {
    throw new Error(t("ui.blockJson.childrenMustBeAnArrayOfBlocks"));
  }

  const children = Array.isArray(node.children)
    ? node.children.map(normalizeBlockNode)
    : null;
  if (children?.some((child) => child === null)) {
    throw new Error(t("ui.blockJson.everyChildNeedsAType"));
  }

  return {
    id: base.id,
    type: node.type,
    version: typeof node.version === "number" && Number.isFinite(node.version) ? node.version : base.version,
    props: (node.props as Record<string, unknown> | undefined) ?? {},
    ...(children ? { children: children as BlockNode[] } : {}),
  };
}

/** The shape shown in the page-level JSON editor. */
export interface PageJsonDraft {
  version: 1;
  header?: unknown;
  blocks: BlockNode[];
}

/**
 * Render the whole page as JSON. `header` is included only when the builder is
 * actually editing one, so a page without header chrome does not grow a key
 * that applying it back would do nothing with.
 */
export function formatPageJson(blocks: BlockNode[], header?: unknown): string {
  const draft: PageJsonDraft = {
    version: 1,
    ...(header !== undefined ? { header } : {}),
    blocks,
  };
  return JSON.stringify(draft, null, 2);
}

/**
 * Parse the page-level JSON editor back into blocks and header chrome.
 *
 * Unlike importing a design, this edits the page in place: a block that already
 * has an id keeps it, so scoped CSS and undo history stay pointed at the same
 * blocks. Only a block arriving without one is given a fresh id.
 */
export function parsePageJson(text: string, t: Translate = translateEnglish): { blocks: BlockNode[]; header?: unknown } {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (err) {
    throw new Error(t("ui.blockJson.invalidJSON"));
  }

  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { blocks?: unknown }).blocks)
      ? ((raw as { blocks: unknown[] }).blocks)
      : null;
  if (!list) {
    throw new Error(t("ui.blockJson.expectedBlocksOrAnArrayOfBlocks"));
  }

  const blocks: BlockNode[] = [];
  list.forEach((item, i) => {
    const node = normalizeBlockNode(item);
    if (!node) throw new Error(t("ui.blockJson.blockIndexNeedsAType", { index: i + 1 }));
    blocks.push(node);
  });

  const header = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as { header?: unknown }).header
    : undefined;

  return { blocks, ...(header !== undefined ? { header } : {}) };
}
