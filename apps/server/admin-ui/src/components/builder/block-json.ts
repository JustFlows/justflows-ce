import type { BlockDocument, BlockNode } from "./types";
import { reassignBlockIds, cloneBlocks } from "./block-tree";

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
export function parseBlockDocumentJson(raw: unknown): BlockDocument {
  if (Array.isArray(raw)) {
    if (!raw.every(isBlockNode)) throw new Error("Invalid block array");
    return { version: 1, blocks: reassignBlockIds(cloneBlocks(raw)) };
  }

  if (typeof raw !== "object" || raw === null) {
    throw new Error("JSON must be a block document or array of blocks");
  }

  const obj = raw as Record<string, unknown>;

  if (obj.type === "justflows/theme-design" && Array.isArray(obj.blocks)) {
    if (!obj.blocks.every(isBlockNode)) throw new Error("Invalid blocks in theme design");
    return { version: 1, blocks: reassignBlockIds(cloneBlocks(obj.blocks as BlockNode[])) };
  }

  if (Array.isArray(obj.blocks)) {
    if (!obj.blocks.every(isBlockNode)) throw new Error("Invalid blocks array");
    return { version: 1, blocks: reassignBlockIds(cloneBlocks(obj.blocks as BlockNode[])) };
  }

  throw new Error("Unrecognized JSON format — expected { blocks: [...] } or a block array");
}

export function parseThemeDesignJson(raw: unknown): { blocks: BlockDocument; mods?: Record<string, unknown> } {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Invalid JSON");
  }
  const obj = raw as Record<string, unknown>;
  const blocks = parseBlockDocumentJson(raw);
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

export async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("File is not valid JSON");
  }
}
