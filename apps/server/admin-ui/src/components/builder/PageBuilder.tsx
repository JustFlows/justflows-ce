import { useCallback, useEffect, useMemo, useState } from "react";
import type { BlockDocument, BlockCatalogEntry, BlockNode } from "./types";
import BlockLibrary from "./BlockLibrary";
import BlockInspector from "./BlockInspector";
import { PageCanvas } from "./BlockCanvas";
import { BuilderDragProvider } from "./DragContext";
import { createBlock } from "./block-defaults";
import { findBlockPath, getBlockAtPath, insertBlock, reassignBlockIds, cloneBlocks, updateBlockProps, updateBlockTree } from "./block-tree";
import { getChildCount, libraryTargetParent } from "./dnd";

export type { BlockDocument, BlockNode } from "./types";

interface PageBuilderProps {
  value: BlockDocument;
  onChange: (doc: BlockDocument) => void;
  compact?: boolean;
}

export default function PageBuilder({ value, onChange, compact = false }: PageBuilderProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<BlockCatalogEntry[]>([]);

  useEffect(() => {
    fetch("/api/blocks")
      .then((r) => r.json())
      .then((data: { blocks: BlockCatalogEntry[] }) => setCatalog(data.blocks ?? []))
      .catch(() => setCatalog([]));
  }, []);

  const catalogMap = useMemo(() => new Map(catalog.map((b) => [b.type, b])), [catalog]);
  const blocks = Array.isArray(value?.blocks) ? value.blocks : [];

  const emit = useCallback((nextBlocks: BlockNode[]) => {
    onChange({ version: 1, blocks: nextBlocks });
  }, [onChange]);

  const selectedBlock = useMemo(() => {
    if (!selectedId) return null;
    const path = findBlockPath(blocks, selectedId);
    if (!path) return null;
    return getBlockAtPath(blocks, path);
  }, [blocks, selectedId]);

  const selectedParentType = useMemo(() => {
    if (!selectedId) return null;
    const path = findBlockPath(blocks, selectedId);
    if (!path || path.length < 2) return null;
    return getBlockAtPath(blocks, path.slice(0, -1))?.type ?? null;
  }, [blocks, selectedId]);

  const addFromLibrary = useCallback((type: string) => {
    const parentId = libraryTargetParent(blocks, selectedId, catalogMap);
    const index = getChildCount(blocks, parentId);
    const block = createBlock(type);
    emit(insertBlock(blocks, parentId, index, block));
    setSelectedId(block.id);
  }, [blocks, selectedId, catalogMap, emit]);

  const importPattern = useCallback((patternBlocks: BlockNode[]) => {
    const fresh = reassignBlockIds(cloneBlocks(patternBlocks));
    const replace =
      blocks.length === 0 ||
      window.confirm("Replace all blocks with this pattern? Cancel to append instead.");
    emit(replace ? fresh : [...blocks, ...fresh]);
    if (fresh[0]) setSelectedId(fresh[0].id);
  }, [blocks, emit]);

  const handlePropsChange = useCallback((props: Record<string, unknown>) => {
    if (!selectedId) return;
    emit(updateBlockProps(blocks, selectedId, props));
  }, [blocks, selectedId, emit]);

  const handleSyncBlock = useCallback((block: BlockNode) => {
    if (!selectedId) return;
    emit(updateBlockTree(blocks, selectedId, () => block));
  }, [blocks, selectedId, emit]);

  const canvas = (
    <PageCanvas
      blocks={blocks}
      catalog={catalogMap}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onChange={emit}
    />
  );

  const inspector = selectedBlock ? (
    <BlockInspector
      block={selectedBlock}
      catalogEntry={catalogMap.get(selectedBlock.type)}
      onChange={handlePropsChange}
      onSyncBlock={handleSyncBlock}
    />
  ) : (
    <p style={{ color: "#94a3b8", fontSize: compact ? "0.8rem" : "0.85rem", textAlign: "center", margin: compact ? "2rem 0" : "3rem 0 0" }}>
      {compact ? "Select a block to edit" : "Select a block to edit its settings"}
    </p>
  );

  return (
    <BuilderDragProvider blocks={blocks} catalog={catalogMap} onChange={emit} onSelect={setSelectedId}>
      {compact ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: "1rem", minHeight: 400 }}>
          {canvas}
          <aside style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "1rem" }}>{inspector}</aside>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 280px", height: "100%", minHeight: 0, background: "#f1f5f9" }}>
          <aside style={{ background: "#fff", borderRight: "1px solid #e2e8f0", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <BlockLibrary catalog={catalog} onAdd={addFromLibrary} onImportPattern={importPattern} parentType={selectedParentType} />
          </aside>
          <main style={{ overflow: "auto", padding: "1.25rem" }} onClick={() => setSelectedId(null)}>
            <div style={{ maxWidth: 900, margin: "0 auto", background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.06)", padding: "1rem", minHeight: "100%" }}>
              {canvas}
            </div>
          </main>
          <aside style={{ background: "#fff", borderLeft: "1px solid #e2e8f0", overflow: "auto", padding: "1rem" }}>{inspector}</aside>
        </div>
      )}
    </BuilderDragProvider>
  );
}
