import type { BlockNode, BlockPath } from "./types";

function cloneBlock(block: BlockNode): BlockNode {
  return {
    ...block,
    props: { ...block.props },
    children: block.children?.map(cloneBlock),
  };
}

export function cloneBlocks(blocks: BlockNode[]): BlockNode[] {
  return blocks.map(cloneBlock);
}

/** Deep-clone blocks and assign fresh ids (for pattern import). */
export function reassignBlockIds(blocks: BlockNode[]): BlockNode[] {
  function walk(block: BlockNode): BlockNode {
    return {
      ...block,
      id: crypto.randomUUID(),
      props: { ...block.props },
      children: block.children?.map(walk),
    };
  }
  return blocks.map(walk);
}

/** Locate a block by id; returns path indices from root. */
export function findBlockPath(blocks: BlockNode[], id: string, prefix: BlockPath = []): BlockPath | null {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.id === id) return [...prefix, i];
    if (block.children?.length) {
      const nested = findBlockPath(block.children, id, [...prefix, i]);
      if (nested) return nested;
    }
  }
  return null;
}

export function getBlockAtPath(blocks: BlockNode[], path: BlockPath): BlockNode | null {
  let list = blocks;
  let node: BlockNode | null = null;
  for (const idx of path) {
    node = list[idx] ?? null;
    if (!node) return null;
    list = node.children ?? [];
  }
  return node;
}

function setAtPath(blocks: BlockNode[], path: BlockPath, updater: (block: BlockNode) => BlockNode): BlockNode[] {
  if (path.length === 0) return blocks;

  const [head, ...rest] = path;
  return blocks.map((block, i) => {
    if (i !== head) return block;
    if (rest.length === 0) return updater(block);
    return {
      ...block,
      children: setAtPath(block.children ?? [], rest, updater),
    };
  });
}

export function updateBlockProps(blocks: BlockNode[], id: string, props: Record<string, unknown>): BlockNode[] {
  const path = findBlockPath(blocks, id);
  if (!path) return blocks;
  return setAtPath(blocks, path, (block) => ({ ...block, props }));
}

export function updateBlockTree(blocks: BlockNode[], id: string, updater: (block: BlockNode) => BlockNode): BlockNode[] {
  const path = findBlockPath(blocks, id);
  if (!path) return blocks;
  return setAtPath(blocks, path, updater);
}

export function removeBlock(blocks: BlockNode[], id: string): BlockNode[] {
  const path = findBlockPath(blocks, id);
  if (!path) return blocks;

  if (path.length === 1) {
    return blocks.filter((_, i) => i !== path[0]);
  }

  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1]!;

  return setAtPath(blocks, parentPath, (parent) => ({
    ...parent,
    children: (parent.children ?? []).filter((_, i) => i !== index),
  }));
}

export function insertBlock(
  blocks: BlockNode[],
  parentId: string | null,
  index: number,
  block: BlockNode,
): BlockNode[] {
  if (!parentId) {
    const next = [...blocks];
    next.splice(index, 0, block);
    return next;
  }

  const path = findBlockPath(blocks, parentId);
  if (!path) return blocks;

  return setAtPath(blocks, path, (parent) => {
    const children = [...(parent.children ?? [])];
    children.splice(index, 0, block);
    return { ...parent, children };
  });
}

export function moveBlock(blocks: BlockNode[], id: string, dir: -1 | 1): BlockNode[] {
  const path = findBlockPath(blocks, id);
  if (!path) return blocks;

  const index = path[path.length - 1]!;
  const swap = index + dir;
  const parentPath = path.slice(0, -1);

  if (parentPath.length === 0) {
    if (swap < 0 || swap >= blocks.length) return blocks;
    const next = [...blocks];
    [next[index], next[swap]] = [next[swap]!, next[index]!];
    return next;
  }

  return setAtPath(blocks, parentPath, (parent) => {
    const children = [...(parent.children ?? [])];
    if (swap < 0 || swap >= children.length) return parent;
    [children[index], children[swap]] = [children[swap]!, children[index]!];
    return { ...parent, children };
  });
}

function isDescendant(block: BlockNode, targetId: string): boolean {
  for (const child of block.children ?? []) {
    if (child.id === targetId) return true;
    if (isDescendant(child, targetId)) return true;
  }
  return false;
}

export function moveBlockTo(
  blocks: BlockNode[],
  blockId: string,
  newParentId: string | null,
  newIndex: number,
): BlockNode[] {
  const path = findBlockPath(blocks, blockId);
  if (!path) return blocks;
  const node = getBlockAtPath(blocks, path);
  if (!node) return blocks;

  if (newParentId === blockId) return blocks;
  if (newParentId && isDescendant(node, newParentId)) return blocks;

  const oldParentPath = path.slice(0, -1);
  const oldIndex = path[path.length - 1]!;
  const oldParentId =
    oldParentPath.length === 0
      ? null
      : getBlockAtPath(blocks, oldParentPath)?.id ?? null;

  let adjustedIndex = newIndex;
  if (oldParentId === newParentId && oldIndex < newIndex) {
    adjustedIndex = newIndex - 1;
  }

  const next = removeBlock(blocks, blockId);
  return insertBlock(next, newParentId, adjustedIndex, node);
}
