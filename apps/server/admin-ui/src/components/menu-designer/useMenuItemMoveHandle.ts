import { useRef } from "react";
import { useMenuDrag, type MenuDropTarget } from "./MenuDragContext";

const MOVE_THRESHOLD = 6;

function parseDropTarget(el: Element): MenuDropTarget | null {
  const zone = el.closest("[data-menu-drop-zone]");
  if (!(zone instanceof HTMLElement)) return null;
  const parentId = zone.dataset.parentId === "root" ? null : (zone.dataset.parentId ?? null);
  const index = Number(zone.dataset.index);
  if (!Number.isFinite(index)) return null;
  return { parentId, index };
}

/** Pointer-based drag handle for one menu item row — same threshold-then-drag mechanics
 * as `components/builder/useBlockMoveHandle.ts`, so keyboard and pointer reordering feel
 * consistent across the admin UI. */
export function useMenuItemMoveHandle(itemId: string) {
  const { startPointerMove, commitPointerMove, setDropTarget } = useMenuDrag();
  const session = useRef<{ pointerId: number; startX: number; startY: number; moving: boolean } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, a, input, textarea, select")) return;

    session.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moving: false };

    const onMove = (ev: PointerEvent) => {
      const s = session.current;
      if (!s || ev.pointerId !== s.pointerId) return;

      if (!s.moving) {
        const dx = Math.abs(ev.clientX - s.startX);
        const dy = Math.abs(ev.clientY - s.startY);
        if (dx < MOVE_THRESHOLD && dy < MOVE_THRESHOLD) return;
        s.moving = true;
        startPointerMove(itemId);
      }

      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      setDropTarget(hit ? parseDropTarget(hit) : null);
    };

    const onUp = (ev: PointerEvent) => {
      const s = session.current;
      if (!s || ev.pointerId !== s.pointerId) return;

      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);

      if (s.moving) {
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        setDropTarget(hit ? parseDropTarget(hit) : null);
        commitPointerMove();
      }

      session.current = null;
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }

  return { onPointerDown };
}
