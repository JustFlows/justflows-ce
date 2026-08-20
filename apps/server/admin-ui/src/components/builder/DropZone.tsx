import { useState } from "react";
import { useBuilderDrag, dropTargetMatches, type DropTarget } from "./DragContext";
import { canDropBlockType } from "./dnd";
import type { BlockCatalogEntry } from "./types";

interface DropZoneProps {
  parentId: string | null;
  parentType: string | null;
  index: number;
  catalog: Map<string, BlockCatalogEntry>;
  label?: string;
  compact?: boolean;
}

export default function DropZone({
  parentId,
  parentType,
  index,
  catalog,
  label = "Drop block here",
  compact = false,
}: DropZoneProps) {
  const { dragging, dragPayload, activeDropTarget, handleLibraryDrop } = useBuilderDrag();
  const [dragOver, setDragOver] = useState(false);

  const target: DropTarget = { parentId, parentType, index };
  const activeType = dragPayload.type;
  const isMoving = dragPayload.blockId !== null;
  const canDrop =
    dragging &&
    activeType !== null &&
    canDropBlockType(parentType, activeType, catalog) &&
    dragPayload.blockId !== parentId;

  const isActive = dropTargetMatches(activeDropTarget, target);
  const highlighted = (isMoving && isActive) || (dragOver && canDrop && !isMoving);

  function onDragOver(e: React.DragEvent) {
    if (isMoving) return;
    const type = dragPayload.type;
    if (!type) return;
    if (!canDropBlockType(parentType, type, catalog)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }

  function onDragLeave(e: React.DragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  }

  function onDrop(e: React.DragEvent) {
    setDragOver(false);
    handleLibraryDrop(parentId, parentType, index, e);
  }

  if (!dragging) return null;

  return (
    <div
      data-drop-zone="true"
      data-parent-id={parentId ?? "root"}
      data-parent-type={parentType ?? "root"}
      data-index={index}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        padding: compact ? "0.2rem 0" : "0.75rem",
        margin: compact ? "0.15rem 0" : "0.35rem 0",
        minHeight: compact ? 24 : 40,
        border: `2px dashed ${highlighted && canDrop ? "#3b82f6" : "#cbd5e1"}`,
        borderRadius: 6,
        background: highlighted && canDrop ? "#eff6ff" : "#fafbfc",
        color: highlighted && canDrop ? "#1d4ed8" : "#94a3b8",
        fontSize: "0.7rem",
        fontWeight: 600,
        textAlign: "center",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background .12s, border-color .12s",
        touchAction: "none",
      }}
    >
      {highlighted && canDrop ? "Release to drop" : compact ? "Drop here" : label}
    </div>
  );
}
