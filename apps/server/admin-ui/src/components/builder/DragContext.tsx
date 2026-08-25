import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";
import type { BlockCatalogEntry, BlockNode } from "./types";
import { createBlock } from "./block-defaults";
import { extractBlock, findBlockPath, insertBlock, moveBlockTo } from "./block-tree";
import { canDropBlockType, DND_BLOCK_TYPE } from "./dnd";
import { HEADER_SELECTED_ID } from "../../lib/page-header";

export interface DragPayload {
  type: string | null;
  blockId: string | null;
}

export interface DropTarget {
  parentId: string | null;
  parentType: string | null;
  index: number;
}

interface BuilderDragContextValue {
  dragging: boolean;
  dragPayload: DragPayload;
  activeDropTarget: DropTarget | null;
  onDragStartType: (type: string) => void;
  onDragEnd: () => void;
  startPointerMove: (blockId: string, type: string) => void;
  commitPointerMove: () => void;
  setDropTarget: (target: DropTarget | null) => void;
  handleLibraryDrop: (parentId: string | null, parentType: string | null, index: number, e: React.DragEvent) => boolean;
}

const BuilderDragContext = createContext<BuilderDragContextValue | null>(null);

export function useBuilderDrag() {
  const ctx = useContext(BuilderDragContext);
  if (!ctx) throw new Error("useBuilderDrag must be used within BuilderDragProvider");
  return ctx;
}

interface BuilderDragProviderProps {
  blocks: BlockNode[];
  headerBlocks?: BlockNode[];
  catalog: Map<string, BlockCatalogEntry>;
  onChange: (blocks: BlockNode[]) => void;
  onHeaderBlocksChange?: (blocks: BlockNode[]) => void;
  onSelect: (id: string | null) => void;
  children: ReactNode;
}

export function BuilderDragProvider({
  blocks,
  headerBlocks = [],
  catalog,
  onChange,
  onHeaderBlocksChange,
  onSelect,
  children,
}: BuilderDragProviderProps) {
  const payloadRef = useRef<DragPayload>({ type: null, blockId: null });
  const dropTargetRef = useRef<DropTarget | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragPayload, setDragPayload] = useState<DragPayload>({ type: null, blockId: null });
  const [activeDropTarget, setActiveDropTarget] = useState<DropTarget | null>(null);

  const reset = useCallback(() => {
    payloadRef.current = { type: null, blockId: null };
    dropTargetRef.current = null;
    setDragPayload({ type: null, blockId: null });
    setActiveDropTarget(null);
    setDragging(false);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, []);

  const syncPayload = useCallback((next: DragPayload) => {
    payloadRef.current = next;
    setDragPayload(next);
    setDragging(next.type !== null);
  }, []);

  const onDragStartType = useCallback((type: string) => {
    syncPayload({ type, blockId: null });
  }, [syncPayload]);

  const onDragEnd = useCallback(() => {
    reset();
  }, [reset]);

  const startPointerMove = useCallback((blockId: string, type: string) => {
    syncPayload({ type, blockId });
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
  }, [syncPayload]);

  const setDropTarget = useCallback((target: DropTarget | null) => {
    dropTargetRef.current = target;
    setActiveDropTarget(target);
  }, []);

  const isHeaderTarget = useCallback(
    (parentId: string | null) => {
      if (parentId === HEADER_SELECTED_ID) return true;
      return Boolean(parentId && findBlockPath(headerBlocks, parentId));
    },
    [headerBlocks],
  );

  const destParentId = (parentId: string | null) =>
    parentId === HEADER_SELECTED_ID ? null : parentId;

  const commitPointerMove = useCallback(() => {
    const payload = payloadRef.current;
    const target = dropTargetRef.current;

    if (payload.blockId && target) {
      const fromHeader = Boolean(findBlockPath(headerBlocks, payload.blockId));
      const node = fromHeader
        ? findBlock(headerBlocks, payload.blockId)
        : findBlock(blocks, payload.blockId);
      const toHeader = isHeaderTarget(target.parentId);
      if (
        node &&
        canDropBlockType(target.parentType, node.type, catalog) &&
        payload.blockId !== target.parentId &&
        !(target.parentId && target.parentId !== HEADER_SELECTED_ID && isDescendant(node, target.parentId))
      ) {
        const destParent = destParentId(target.parentId);
        if (fromHeader && toHeader && onHeaderBlocksChange) {
          onHeaderBlocksChange(moveBlockTo(headerBlocks, payload.blockId, destParent, target.index));
        } else if (!fromHeader && !toHeader) {
          onChange(moveBlockTo(blocks, payload.blockId, destParent, target.index));
        } else if (fromHeader && !toHeader && onHeaderBlocksChange) {
          const extracted = extractBlock(headerBlocks, payload.blockId);
          if (extracted) {
            onHeaderBlocksChange(extracted.blocks);
            onChange(insertBlock(blocks, destParent, target.index, extracted.node));
          }
        } else if (!fromHeader && toHeader && onHeaderBlocksChange) {
          const extracted = extractBlock(blocks, payload.blockId);
          if (extracted) {
            onChange(extracted.blocks);
            onHeaderBlocksChange(insertBlock(headerBlocks, destParent, target.index, extracted.node));
          }
        }
        onSelect(payload.blockId);
      }
    }

    reset();
  }, [blocks, headerBlocks, catalog, isHeaderTarget, onChange, onHeaderBlocksChange, onSelect, reset]);

  const handleLibraryDrop = useCallback(
    (parentId: string | null, parentType: string | null, index: number, e: React.DragEvent): boolean => {
      e.preventDefault();
      e.stopPropagation();

      const type = e.dataTransfer.getData(DND_BLOCK_TYPE) || payloadRef.current.type;
      if (!type || payloadRef.current.blockId) return false;
      if (!canDropBlockType(parentType, type, catalog)) return false;

      const block = createBlock(type);
      if (isHeaderTarget(parentId)) {
        if (!onHeaderBlocksChange) return false;
        onHeaderBlocksChange(insertBlock(headerBlocks, destParentId(parentId), index, block));
      } else {
        onChange(insertBlock(blocks, parentId, index, block));
      }
      onSelect(block.id);
      reset();
      return true;
    },
    [blocks, headerBlocks, catalog, isHeaderTarget, onChange, onHeaderBlocksChange, onSelect, reset],
  );

  return (
    <BuilderDragContext.Provider
      value={{
        dragging,
        dragPayload,
        activeDropTarget,
        onDragStartType,
        onDragEnd,
        startPointerMove,
        commitPointerMove,
        setDropTarget,
        handleLibraryDrop,
      }}
    >
      {children}
    </BuilderDragContext.Provider>
  );
}

function findBlock(blocks: BlockNode[], id: string): BlockNode | null {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.children?.length) {
      const nested = findBlock(b.children, id);
      if (nested) return nested;
    }
  }
  return null;
}

function isDescendant(block: BlockNode, targetId: string): boolean {
  for (const child of block.children ?? []) {
    if (child.id === targetId) return true;
    if (isDescendant(child, targetId)) return true;
  }
  return false;
}

export function dropTargetMatches(a: DropTarget | null, b: DropTarget): boolean {
  if (!a) return false;
  return a.parentId === b.parentId && a.index === b.index;
}
