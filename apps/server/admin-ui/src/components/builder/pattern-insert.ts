import type { BlockNode } from "./types";

/** Only whole-page compositions own the canvas; section patterns append. */
export function patternReplacesCanvas(category?: string): boolean {
  return category === "pages";
}

export function mergePatternBlocks(
  current: BlockNode[],
  imported: BlockNode[],
  replaceCanvas: boolean,
): BlockNode[] {
  return replaceCanvas ? imported : [...current, ...imported];
}
