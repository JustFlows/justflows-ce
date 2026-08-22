import { useState } from "react";
import type { BlockNode, BlockCatalogEntry } from "./types";
import { BlockPreview } from "./BlockPreview";
import { createBlock } from "./block-defaults";
import { insertBlock, moveBlock, removeBlock } from "./block-tree";
import DropZone from "./DropZone";
import { useBuilderDrag } from "./DragContext";
import { useBlockMoveHandle } from "./useBlockMoveHandle";

const iconBtn: React.CSSProperties = {
  background: "#f1f5f9",
  border: "none",
  borderRadius: 4,
  padding: "0.15rem 0.4rem",
  cursor: "pointer",
  fontSize: "0.75rem",
  color: "#64748b",
};

interface PageCanvasProps {
  blocks: BlockNode[];
  catalog: Map<string, BlockCatalogEntry>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (blocks: BlockNode[]) => void;
}

export function PageCanvas({ blocks, catalog, selectedId, onSelect, onChange }: PageCanvasProps) {
  const { dragging } = useBuilderDrag();

  return (
    <div style={{ minHeight: blocks.length === 0 ? 320 : undefined }}>
        {blocks.length === 0 && !dragging && (
          <div style={{ padding: "3rem 2rem", textAlign: "center", border: "2px dashed #cbd5e1", borderRadius: 10, color: "#94a3b8", marginBottom: "0.75rem" }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem", opacity: 0.5 }}>▭</div>
            <p style={{ margin: 0, fontSize: "0.9rem" }}>Drag a section or hero here</p>
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.8rem" }}>Or pick from the library on the left</p>
          </div>
        )}

        {blocks.length === 0 && dragging && (
          <DropZone parentId={null} parentType={null} index={0} catalog={catalog} label="Drop section here" />
        )}

        {blocks.map((block, i) => (
          <div key={block.id}>
            <DropZone parentId={null} parentType={null} index={i} catalog={catalog} compact />
            <BlockRow
              block={block}
              blocks={blocks}
              catalog={catalog}
              selectedId={selectedId}
              onSelect={onSelect}
              onRootChange={onChange}
              index={i}
              total={blocks.length}
              depth={0}
            />
          </div>
        ))}

        {blocks.length > 0 && (
          <DropZone parentId={null} parentType={null} index={blocks.length} catalog={catalog} compact label="Drop at end" />
        )}

        <AddBlockSlot
          label="+ Add section"
          onPick={(type) => {
            const block = createBlock(type);
            onChange([...blocks, block]);
            onSelect(block.id);
          }}
          catalog={catalog}
          parentType={null}
        />
    </div>
  );
}

function BlockRow({
  block,
  blocks,
  catalog,
  selectedId,
  onSelect,
  onRootChange,
  index,
  total,
  depth,
  parentBlocks,
  onParentChange,
  parentType = null,
}: {
  block: BlockNode;
  blocks: BlockNode[];
  catalog: Map<string, BlockCatalogEntry>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRootChange: (blocks: BlockNode[]) => void;
  index: number;
  total: number;
  depth: number;
  parentBlocks?: BlockNode[];
  onParentChange?: (blocks: BlockNode[]) => void;
  parentType?: string | null;
}) {
  const meta = catalog.get(block.type);
  const isSelected = selectedId === block.id;
  const hasChildren = meta?.supportsChildren ?? false;
  const { dragPayload } = useBuilderDrag();
  const { onPointerDown } = useBlockMoveHandle(block.id, block.type);
  const isBeingMoved = dragPayload.blockId === block.id;
  const children = block.children ?? [];

  const move = (dir: -1 | 1) => {
    const list = parentBlocks ?? blocks;
    const change = parentBlocks ? onParentChange! : onRootChange;
    change(moveBlock(list, block.id, dir));
  };

  const remove = () => {
    const list = parentBlocks ?? blocks;
    const change = parentBlocks ? onParentChange! : onRootChange;
    change(removeBlock(list, block.id));
    if (selectedId === block.id) onSelect(null);
  };

  const updateChildren = (nextChildren: BlockNode[]) => {
    const list = parentBlocks ?? blocks;
    const change = parentBlocks ? onParentChange! : onRootChange;
    change(list.map((b) => (b.id === block.id ? { ...b, children: nextChildren } : b)));
  };

  return (
    <div
      style={{
        marginBottom: depth === 0 ? "0.75rem" : "0.4rem",
        border: `2px solid ${isSelected ? "#3b82f6" : "transparent"}`,
        borderRadius: depth === 0 ? 10 : 6,
        background: isSelected ? "#f8fbff" : "transparent",
        opacity: isBeingMoved ? 0.45 : 1,
        transition: "border-color .12s, opacity .12s",
      }}
      onClick={(e) => { e.stopPropagation(); onSelect(isSelected ? null : block.id); }}
    >
      <div
        onPointerDown={onPointerDown}
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: depth === 0 ? "0.4rem 0.6rem 0" : "0.25rem 0.35rem 0",
          cursor: "grab",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <span
          title="Drag to move"
          aria-hidden="true"
          style={{ color: "#94a3b8", fontSize: "0.85rem", padding: "0 0.15rem", userSelect: "none", flexShrink: 0 }}
        >
          ⠿
        </span>
        <span style={{ fontSize: "0.65rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {meta?.icon} {meta?.title ?? block.type}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.2rem" }} onClick={(e) => e.stopPropagation()}>
          <button type="button" aria-label="Move block up" onClick={() => move(-1)} disabled={index === 0} style={iconBtn}>↑</button>
          <button type="button" aria-label="Move block down" onClick={() => move(1)} disabled={index === total - 1} style={iconBtn}>↓</button>
          <button type="button" aria-label="Remove block" onClick={remove} style={{ ...iconBtn, color: "#dc2626" }}>✕</button>
        </div>
      </div>

      <div style={{ padding: depth === 0 ? "0.5rem 0.6rem 0.6rem" : "0.25rem 0.35rem 0.35rem" }}>
        <BlockPreview
          block={block}
          depth={depth}
          selectedId={selectedId}
          onSelect={onSelect}
          renderChildren={
            hasChildren
              ? (_childList, childDepth) => (
                  <div style={{ minHeight: children.length === 0 ? 56 : undefined }}>
                    {children.length === 0 && (
                      <DropZone
                        parentId={block.id}
                        parentType={block.type}
                        index={0}
                        catalog={catalog}
                        label="Drop blocks here"
                      />
                    )}
                      {children.map((child, ci) => (
                        <div key={child.id}>
                          <DropZone parentId={block.id} parentType={block.type} index={ci} catalog={catalog} compact />
                          <BlockRow
                            block={child}
                            blocks={blocks}
                            catalog={catalog}
                            selectedId={selectedId}
                            onSelect={onSelect}
                            onRootChange={onRootChange}
                            index={ci}
                            total={children.length}
                            depth={childDepth}
                            parentBlocks={children}
                            onParentChange={updateChildren}
                            parentType={block.type}
                          />
                        </div>
                      ))}
                      {children.length > 0 && (
                        <DropZone parentId={block.id} parentType={block.type} index={children.length} catalog={catalog} compact />
                      )}
                      {block.type !== "core.columns" && (
                        <AddBlockSlot
                          label="+ Add block"
                          onPick={(type) => onRootChange(insertBlock(blocks, block.id, children.length, createBlock(type)))}
                          catalog={catalog}
                          parentType={block.type}
                          allowedChildTypes={meta?.allowedChildTypes}
                        />
                      )}
                    </div>
                )
              : undefined
          }
        />
      </div>
    </div>
  );
}

function AddBlockSlot({
  label,
  onPick,
  catalog,
  parentType,
  allowedChildTypes,
}: {
  label: string;
  onPick: (type: string) => void;
  catalog: Map<string, BlockCatalogEntry>;
  parentType: string | null;
  allowedChildTypes?: string[];
}) {
  const [open, setOpen] = useState(false);
  const entries = [...catalog.values()].filter((b) => {
    if (b.type === "core.column") return parentType === "core.columns";
    if (allowedChildTypes?.length) return allowedChildTypes.includes(b.type);
    if (parentType === "core.columns") return false;
    if (parentType === "core.column") return b.type !== "core.column" && b.type !== "core.columns";
    if (!parentType) return b.type !== "core.column";
    return b.type !== "core.column";
  });

  const quick = parentType
    ? entries.slice(0, 12)
    : entries.filter((b) => b.category === "sections" || b.type === "core.section").slice(0, 6);

  return (
    <div style={{ position: "relative", marginTop: "0.35rem" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "0.45rem",
          border: "1px dashed #cbd5e1",
          borderRadius: 6,
          background: "#fafbfc",
          color: "#64748b",
          fontSize: "0.75rem",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {label}
      </button>
      {open && (
        <div style={{
          position: "absolute",
          bottom: "100%",
          left: 0,
          right: 0,
          zIndex: 40,
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,.1)",
          padding: "0.4rem",
          marginBottom: "0.25rem",
          maxHeight: 280,
          overflow: "auto",
        }}>
          {quick.map((b) => (
            <button
              key={b.type}
              type="button"
              onClick={() => { onPick(b.type); setOpen(false); }}
              style={{ display: "flex", width: "100%", gap: "0.5rem", padding: "0.4rem 0.5rem", border: "none", background: "none", cursor: "pointer", borderRadius: 4, fontSize: "0.78rem", textAlign: "left" }}
            >
              <span>{b.icon}</span> {b.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
