import type { BlockCatalogEntry, BlockNode } from "./types";

export const DND_BLOCK_TYPE = "application/x-justflows-block-type";
export const DND_BLOCK_ID = "application/x-justflows-block-id";

export function canDropBlockType(
  parentType: string | null,
  childType: string,
  catalog: Map<string, BlockCatalogEntry>,
): boolean {
  if (childType === "core.column") return parentType === "core.columns";

  if (!parentType) return childType !== "core.column";

  const parent = catalog.get(parentType);
  if (!parent?.supportsChildren) return false;

  if (parent.allowedChildTypes?.length) {
    return parent.allowedChildTypes.includes(childType);
  }

  if (parentType === "core.columns") return false;
  if (parentType === "core.column") {
    return childType !== "core.column" && childType !== "core.columns";
  }

  return childType !== "core.column";
}

export function libraryTargetParent(
  blocks: BlockNode[],
  selectedId: string | null,
  catalog: Map<string, BlockCatalogEntry>,
): string | null {
  if (!selectedId) return null;

  const find = (list: BlockNode[]): BlockNode | null => {
    for (const b of list) {
      if (b.id === selectedId) return b;
      if (b.children?.length) {
        const nested = find(b.children);
        if (nested) return nested;
      }
    }
    return null;
  };

  const selected = find(blocks);
  if (!selected) return null;

  const meta = catalog.get(selected.type);
  if (meta?.supportsChildren && selected.type !== "core.columns") {
    return selected.id;
  }

  return null;
}

export function getChildCount(blocks: BlockNode[], parentId: string | null): number {
  if (!parentId) return blocks.length;

  const find = (list: BlockNode[]): number | null => {
    for (const b of list) {
      if (b.id === parentId) return (b.children ?? []).length;
      if (b.children?.length) {
        const n = find(b.children);
        if (n !== null) return n;
      }
    }
    return null;
  };

  return find(blocks) ?? 0;
}

export function getParentType(blocks: BlockNode[], parentId: string | null): string | null {
  if (!parentId) return null;

  const find = (list: BlockNode[]): string | null => {
    for (const b of list) {
      if (b.id === parentId) return b.type;
      if (b.children?.length) {
        const t = find(b.children);
        if (t) return t;
      }
    }
    return null;
  };

  return find(blocks);
}
