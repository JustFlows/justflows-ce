import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";
import { getItemAtPath, findItemPath, itemDepth, maxTreeDepth, moveItemTo, type MenuItem } from "./menu-tree";

export interface MenuDropTarget {
  parentId: string | null;
  index: number;
}

interface MenuDragContextValue {
  dragging: boolean;
  draggingId: string | null;
  activeDropTarget: MenuDropTarget | null;
  startPointerMove: (itemId: string) => void;
  commitPointerMove: () => void;
  setDropTarget: (target: MenuDropTarget | null) => void;
}

const MenuDragContext = createContext<MenuDragContextValue | null>(null);

export function useMenuDrag(): MenuDragContextValue {
  const ctx = useContext(MenuDragContext);
  if (!ctx) throw new Error("useMenuDrag must be used within MenuDragProvider");
  return ctx;
}

interface MenuDragProviderProps {
  items: MenuItem[];
  maxDepth: number;
  onChange: (items: MenuItem[]) => void;
  children: ReactNode;
}

/** Trimmed adaptation of `components/builder/DragContext.tsx` for a single menu-item tree —
 * no header/library dual-tree case here, plus a depth-limit check the block tree doesn't need. */
export function MenuDragProvider({ items, maxDepth, onChange, children }: MenuDragProviderProps) {
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const draggingIdRef = useRef<string | null>(null);
  const dropTargetRef = useRef<MenuDropTarget | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [activeDropTarget, setActiveDropTarget] = useState<MenuDropTarget | null>(null);

  const reset = useCallback(() => {
    draggingIdRef.current = null;
    dropTargetRef.current = null;
    setDraggingId(null);
    setActiveDropTarget(null);
    setDragging(false);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, []);

  const startPointerMove = useCallback((itemId: string) => {
    draggingIdRef.current = itemId;
    setDraggingId(itemId);
    setDragging(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
  }, []);

  const setDropTarget = useCallback((target: MenuDropTarget | null) => {
    dropTargetRef.current = target;
    setActiveDropTarget(target);
  }, []);

  const commitPointerMove = useCallback(() => {
    const id = draggingIdRef.current;
    const target = dropTargetRef.current;
    const current = itemsRef.current;

    if (id && target && findItemPath(current, id)) {
      const node = getItemAtPath(current, findItemPath(current, id)!);
      const newParentDepth = target.parentId ? (itemDepth(current, target.parentId) ?? 0) : 0;
      const subtreeHeight = node ? maxTreeDepth([node]) : 1;
      if (id !== target.parentId && newParentDepth + subtreeHeight <= maxDepth) {
        onChange(moveItemTo(current, id, target.parentId, target.index));
      }
    }
    reset();
  }, [maxDepth, onChange, reset]);

  return (
    <MenuDragContext.Provider
      value={{ dragging, draggingId, activeDropTarget, startPointerMove, commitPointerMove, setDropTarget }}
    >
      {children}
    </MenuDragContext.Provider>
  );
}
