import { useRef } from "react";
import { useBuilderDrag, type DropTarget } from "./DragContext";

const MOVE_THRESHOLD = 6;

function parseDropTarget(el: Element): DropTarget | null {
  const zone = el.closest("[data-drop-zone]");
  if (!(zone instanceof HTMLElement)) return null;
  const parentId = zone.dataset.parentId === "root" ? null : zone.dataset.parentId ?? null;
  const parentType = zone.dataset.parentType === "root" ? null : zone.dataset.parentType ?? null;
  const index = Number(zone.dataset.index);
  if (!Number.isFinite(index)) return null;
  return { parentId, parentType, index };
}

export function useBlockMoveHandle(blockId: string, blockType: string) {
  const { startPointerMove, commitPointerMove, setDropTarget } = useBuilderDrag();
  const session = useRef<{ pointerId: number; startX: number; startY: number; moving: boolean } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;

    session.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moving: false };

    const onMove = (ev: PointerEvent) => {
      const s = session.current;
      if (!s || ev.pointerId !== s.pointerId) return;

      if (!s.moving) {
        const dx = Math.abs(ev.clientX - s.startX);
        const dy = Math.abs(ev.clientY - s.startY);
        if (dx < MOVE_THRESHOLD && dy < MOVE_THRESHOLD) return;
        s.moving = true;
        startPointerMove(blockId, blockType);
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
