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
  /** Keep the target visible when nothing is being dragged (empty columns). */
  alwaysShow?: boolean;
  inline?: boolean;
}

export default function DropZone({
  parentId,
  parentType,
  index,
  catalog,
  label = "Drop block here",
  compact = false,
  alwaysShow = false,
  inline = false,
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

  function onDragEnter(e: React.DragEvent) {
    if (isMoving) return;
    const type = dragPayload.type;
    if (!type || !canDropBlockType(parentType, type, catalog)) return;
    e.preventDefault();
    e.stopPropagation();
  }

  function onDragLeave(e: React.DragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  }

  function onDrop(e: React.DragEvent) {
    setDragOver(false);
    handleLibraryDrop(parentId, parentType, index, e);
  }

  if (!dragging && !alwaysShow) return null;

  return (
    <div
      data-drop-zone="true"
      data-parent-id={parentId ?? "root"}
      data-parent-type={parentType ?? "root"}
      data-index={index}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        padding: inline ? "0.15rem 0.4rem" : compact ? "0.2rem 0" : "0.75rem",
        margin: inline ? "0 0.15rem" : compact ? "0.15rem 0" : "0.35rem 0",
        minHeight: compact ? 24 : alwaysShow ? 56 : 40,
        minWidth: inline ? (compact ? 72 : 120) : undefined,
        flex: inline ? "1 1 auto" : undefined,
        border: `2px dashed ${highlighted && canDrop ? "var(--jf-accent)" : "var(--jf-border-strong)"}`,
        borderRadius: 6,
        background: highlighted && canDrop ? "var(--jf-accent-soft)" : "var(--jf-surface-2)",
        color: highlighted && canDrop ? "var(--jf-accent-hover)" : "var(--jf-text-3)",
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
