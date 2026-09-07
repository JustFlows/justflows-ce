import { useState } from "react";
import { useT } from "../../i18n/I18nProvider";
import { MenuDragProvider, useMenuDrag, type MenuDropTarget } from "./MenuDragContext";
import { useMenuItemMoveHandle } from "./useMenuItemMoveHandle";
import {
  duplicateItem,
  flattenItems,
  indentItem,
  moveItem,
  outdentItem,
  removeItem,
  type MenuItem,
} from "./menu-tree";

interface MenuTreeViewProps {
  items: MenuItem[];
  maxDepth: number;
  selectedId: string | null;
  canManage: boolean;
  typeLabel: (type: string) => string;
  contentSlugFor?: (item: MenuItem) => string | undefined;
  onSelectItem: (id: string | null) => void;
  onChange: (items: MenuItem[]) => void;
}

function zoneMatches(target: MenuDropTarget | null, parentId: string | null, index: number): boolean {
  if (!target) return false;
  return target.parentId === parentId && target.index === index;
}

function DropZone({
  parentId,
  index,
  nested,
}: {
  parentId: string | null;
  index: number;
  nested?: boolean;
}) {
  const { dragging, activeDropTarget } = useMenuDrag();
  if (!dragging) return null;
  const active = zoneMatches(activeDropTarget, parentId, index);
  return (
    <div
      className={`jf-menu-dropzone${nested ? " jf-menu-dropzone--nested" : ""}${active ? " jf-menu-dropzone--active" : ""}`}
      data-menu-drop-zone
      data-parent-id={parentId ?? "root"}
      data-index={index}
    />
  );
}

function MenuTreeRow({
  item,
  depth,
  path,
  siblingCount,
  selectedId,
  canManage,
  typeLabel,
  contentSlugFor,
  onSelectItem,
  onChange,
  items,
  collapsed,
  onToggleCollapse,
}: {
  item: MenuItem;
  depth: number;
  path: number[];
  siblingCount: number;
  selectedId: string | null;
  canManage: boolean;
  typeLabel: (type: string) => string;
  contentSlugFor?: (item: MenuItem) => string | undefined;
  onSelectItem: (id: string | null) => void;
  onChange: (items: MenuItem[]) => void;
  items: MenuItem[];
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const { t } = useT();
  const { draggingId } = useMenuDrag();
  const { onPointerDown } = useMenuItemMoveHandle(item.id);
  const index = path[path.length - 1]!;
  const selected = selectedId === item.id;
  const hasChildren = Boolean(item.children?.length);

  return (
    <div
      className={`jf-itemrow${selected ? " jf-itemrow--selected" : ""}${draggingId === item.id ? " jf-itemrow--dragging" : ""}`}
      data-depth={depth}
    >
      {canManage && (
        <span
          className="jf-drag-handle"
          aria-hidden="true"
          title={t("menus.dragToReorder")}
          onPointerDown={onPointerDown}
        >
          ⠿
        </span>
      )}
      {/* A separate real <button>, not nested in the row-select button below — same reason
          the move/indent/duplicate/delete buttons aren't nested in it either. */}
      {hasChildren ? (
        <button
          type="button"
          className="jf-iconbtn"
          title={collapsed ? t("menus.expand") : t("menus.collapse")}
          aria-label={collapsed ? t("menus.expand") : t("menus.collapse")}
          aria-expanded={!collapsed}
          onClick={onToggleCollapse}
        >
          {collapsed ? "▸" : "▾"}
        </button>
      ) : (
        <span className="jf-iconbtn" aria-hidden="true" style={{ visibility: "hidden" }} />
      )}
      {/* A real <button>, not the whole row — the row also holds the move/indent/duplicate/
          delete buttons below, and an interactive control may not contain another one. */}
      <button
        type="button"
        className="jf-itemrow__select"
        style={{ flex: 1, minWidth: 0, textAlign: "start", background: "none", border: "none", padding: 0, cursor: "pointer" }}
        aria-pressed={selected}
        onClick={() => onSelectItem(item.id)}
      >
        <div className="jf-row" style={{ alignItems: "center" }}>
          <strong className="jf-truncate">{item.label || t("menus.untitled")}</strong>
          <span className="jf-badge jf-badge--info">{typeLabel(item.type)}</span>
          {item.contentId && contentSlugFor?.(item) ? (
            <span className="jf-meta">{contentSlugFor(item)}</span>
          ) : null}
          {item.megaMenu?.regions?.length ? (
            <span className="jf-badge">{t("menus.hasMegaMenu")}</span>
          ) : null}
          {collapsed && hasChildren && (
            <span className="jf-meta">{t("menus.collapsedCount", { count: item.children!.length })}</span>
          )}
        </div>
      </button>

      {canManage && (
        <div className="jf-stack" style={{ gap: "0.25rem", flexShrink: 0, flexDirection: "row" }}>
          <button
            className="jf-iconbtn"
            title={t("menus.moveUp")}
            aria-label={t("menus.moveUp")}
            disabled={index === 0}
            onClick={() => onChange(moveItem(items, item.id, -1))}
          >
            ↑
          </button>
          <button
            className="jf-iconbtn"
            title={t("menus.moveDown")}
            aria-label={t("menus.moveDown")}
            disabled={index === siblingCount - 1}
            onClick={() => onChange(moveItem(items, item.id, 1))}
          >
            ↓
          </button>
          <button
            className="jf-iconbtn"
            title={t("menus.outdent")}
            aria-label={t("menus.outdent")}
            disabled={depth === 0}
            onClick={() => onChange(outdentItem(items, item.id))}
          >
            ←
          </button>
          <button
            className="jf-iconbtn"
            title={t("menus.indent")}
            aria-label={t("menus.indent")}
            disabled={index === 0}
            onClick={() => onChange(indentItem(items, item.id))}
          >
            →
          </button>
          <button
            className="jf-iconbtn"
            title={t("menus.duplicate")}
            aria-label={t("menus.duplicate")}
            onClick={() => {
              const { items: next, newId } = duplicateItem(items, item.id);
              onChange(next);
              onSelectItem(newId);
            }}
          >
            ⧉
          </button>
          <button
            className="jf-iconbtn jf-iconbtn--danger"
            title={t("common.delete")}
            aria-label={t("common.delete")}
            onClick={() => {
              onChange(removeItem(items, item.id));
              if (selected) onSelectItem(null);
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export default function MenuTreeView({
  items,
  maxDepth,
  selectedId,
  canManage,
  typeLabel,
  contentSlugFor,
  onSelectItem,
  onChange,
}: MenuTreeViewProps) {
  const { t } = useT();
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const flat = flattenItems(items);

  // Collapsing is a view-only convenience over the already-flattened list, not part of the
  // saved menu — drop every row whose nearest collapsed ancestor precedes it. `flattenItems` is
  // depth-first pre-order, so a collapsed item's whole subtree is exactly the contiguous run of
  // rows immediately after it with a greater depth.
  const visible: typeof flat = [];
  let skipBelowDepth: number | null = null;
  for (const row of flat) {
    if (skipBelowDepth !== null && row.depth > skipBelowDepth) continue;
    skipBelowDepth = null;
    visible.push(row);
    if (row.item.children?.length && collapsedIds.has(row.item.id)) skipBelowDepth = row.depth;
  }

  function toggleCollapse(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <MenuDragProvider items={items} maxDepth={maxDepth} onChange={onChange}>
      <div className="jf-stack jf-stack--sm">
        {visible.map(({ item, depth, path }) => {
          const parentPath = path.slice(0, -1);
          let siblings = items;
          for (const idx of parentPath) siblings = siblings[idx]?.children ?? [];
          const parentId = parentPath.length ? getIdAtPath(items, parentPath) : null;

          return (
            <div key={item.id}>
              {canManage && <DropZone parentId={parentId} index={path[path.length - 1]!} />}
              <MenuTreeRow
                item={item}
                depth={depth}
                path={path}
                siblingCount={siblings.length}
                selectedId={selectedId}
                canManage={canManage}
                typeLabel={typeLabel}
                contentSlugFor={contentSlugFor}
                onSelectItem={onSelectItem}
                onChange={onChange}
                items={items}
                collapsed={collapsedIds.has(item.id)}
                onToggleCollapse={() => toggleCollapse(item.id)}
              />
              {canManage && item.children?.length && !collapsedIds.has(item.id) ? (
                <DropZone parentId={item.id} index={item.children.length} nested />
              ) : null}
            </div>
          );
        })}
        {canManage && <DropZone parentId={null} index={items.length} />}
        {items.length === 0 && (
          <div className="jf-empty">
            <span className="jf-empty__icon" aria-hidden="true">☰</span>
            <span className="jf-empty__title">{t("menus.empty")}</span>
            <p>{t("menus.emptyHint")}</p>
          </div>
        )}
      </div>
    </MenuDragProvider>
  );
}

function getIdAtPath(items: MenuItem[], path: number[]): string | null {
  let list = items;
  let node: MenuItem | null = null;
  for (const idx of path) {
    node = list[idx] ?? null;
    if (!node) return null;
    list = node.children ?? [];
  }
  return node?.id ?? null;
}
