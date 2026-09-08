/**
 * Immutable tree helpers for the menu designer's item tree, mirroring
 * `components/builder/block-tree.ts`'s path-based approach so both trees are
 * manipulated the same way — plus indent/outdent/duplicate, which a menu
 * needs and a block tree does not.
 */
import { uid } from "../../lib/uid";
import type { BlockNode } from "../builder/types";

export interface MenuItemBadge {
  text: string;
  tone?: "info" | "success" | "warning" | "danger";
}

export interface MenuItemVisibility {
  auth?: "any" | "guest" | "authenticated";
  roles?: string[];
  locales?: string[];
  devices?: Array<"desktop" | "tablet" | "mobile">;
  condition?: { id: string; params?: Record<string, unknown> };
}

export interface MenuItemDropdown {
  trigger?: "hover" | "click" | "both";
  align?: "start" | "center" | "end";
  width?: "auto" | "menu" | "viewport" | number;
  maxWidth?: number;
  columns?: number;
  /** px nudge of the open panel; positive = right / down, negative = left / up. */
  offsetX?: number;
  offsetY?: number;
  disableParentLink?: boolean;
}

export interface MegaMenuRegion {
  id: string;
  heading?: string;
  span?: number;
  blocks: BlockNode[];
}

export interface MenuButtonStyle {
  bg?: string;
  fg?: string;
  border?: string;
  borderWidth?: number;
  radius?: number;
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
}

export interface MenuItem {
  id: string;
  label: string;
  type: string;
  url?: string;
  contentId?: string;
  target?: "_blank";
  rel?: string;
  titleAttr?: string;
  stylePreset?: string;
  buttonStyle?: MenuButtonStyle;
  icon?: string;
  image?: string;
  badge?: MenuItemBadge;
  description?: string;
  visibility?: MenuItemVisibility;
  dropdown?: MenuItemDropdown;
  megaMenu?: { regions: MegaMenuRegion[] };
  children?: MenuItem[];
}

export type MenuItemPath = number[];

function cloneItem(item: MenuItem): MenuItem {
  return { ...item, children: item.children?.map(cloneItem) };
}

export function cloneItems(items: MenuItem[]): MenuItem[] {
  return items.map(cloneItem);
}

/** Deep-clone an item and every descendant with fresh ids (for duplicate). */
function reassignIds(item: MenuItem): MenuItem {
  return { ...item, id: uid(), children: item.children?.map(reassignIds) };
}

export function findItemPath(items: MenuItem[], id: string, prefix: MenuItemPath = []): MenuItemPath | null {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.id === id) return [...prefix, i];
    if (item.children?.length) {
      const nested = findItemPath(item.children, id, [...prefix, i]);
      if (nested) return nested;
    }
  }
  return null;
}

export function getItemAtPath(items: MenuItem[], path: MenuItemPath): MenuItem | null {
  let list = items;
  let node: MenuItem | null = null;
  for (const idx of path) {
    node = list[idx] ?? null;
    if (!node) return null;
    list = node.children ?? [];
  }
  return node;
}

/** 1-based depth of `id` (a root item is depth 1), or `null` if not found. */
export function itemDepth(items: MenuItem[], id: string): number | null {
  const path = findItemPath(items, id);
  return path ? path.length : null;
}

/** Depth of the deepest path in `items`, root items counting as depth 1. */
export function maxTreeDepth(items: MenuItem[]): number {
  let depth = 0;
  for (const item of items) {
    const childDepth = item.children?.length ? maxTreeDepth(item.children) : 0;
    depth = Math.max(depth, 1 + childDepth);
  }
  return depth;
}

function setAtPath(items: MenuItem[], path: MenuItemPath, updater: (item: MenuItem) => MenuItem): MenuItem[] {
  if (path.length === 0) return items;
  const [head, ...rest] = path;
  return items.map((item, i) => {
    if (i !== head) return item;
    if (rest.length === 0) return updater(item);
    return { ...item, children: setAtPath(item.children ?? [], rest, updater) };
  });
}

export function updateItem(items: MenuItem[], id: string, updater: (item: MenuItem) => MenuItem): MenuItem[] {
  const path = findItemPath(items, id);
  if (!path) return items;
  return setAtPath(items, path, updater);
}

export function removeItem(items: MenuItem[], id: string): MenuItem[] {
  const path = findItemPath(items, id);
  if (!path) return items;

  if (path.length === 1) {
    return items.filter((_, i) => i !== path[0]);
  }
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1]!;
  return setAtPath(items, parentPath, (parent) => ({
    ...parent,
    children: (parent.children ?? []).filter((_, i) => i !== index),
  }));
}

export function extractItem(items: MenuItem[], id: string): { items: MenuItem[]; node: MenuItem } | null {
  const path = findItemPath(items, id);
  if (!path) return null;
  const node = getItemAtPath(items, path);
  if (!node) return null;
  return { items: removeItem(items, id), node };
}

export function insertItem(
  items: MenuItem[],
  parentId: string | null,
  index: number,
  item: MenuItem,
): MenuItem[] {
  if (!parentId) {
    const next = [...items];
    next.splice(index, 0, item);
    return next;
  }
  const path = findItemPath(items, parentId);
  if (!path) return items;
  return setAtPath(items, path, (parent) => {
    const children = [...(parent.children ?? [])];
    children.splice(index, 0, item);
    return { ...parent, children };
  });
}

function isDescendant(item: MenuItem, targetId: string): boolean {
  for (const child of item.children ?? []) {
    if (child.id === targetId) return true;
    if (isDescendant(child, targetId)) return true;
  }
  return false;
}

/** Reparent/reorder `itemId` to become child `newIndex` of `newParentId` (`null` = top level). */
export function moveItemTo(
  items: MenuItem[],
  itemId: string,
  newParentId: string | null,
  newIndex: number,
): MenuItem[] {
  const path = findItemPath(items, itemId);
  if (!path) return items;
  const node = getItemAtPath(items, path);
  if (!node) return items;

  if (newParentId === itemId) return items;
  if (newParentId && isDescendant(node, newParentId)) return items;

  const oldParentPath = path.slice(0, -1);
  const oldIndex = path[path.length - 1]!;
  const oldParentId = oldParentPath.length === 0 ? null : getItemAtPath(items, oldParentPath)?.id ?? null;

  let adjustedIndex = newIndex;
  if (oldParentId === newParentId && oldIndex < newIndex) adjustedIndex = newIndex - 1;

  const next = removeItem(items, itemId);
  return insertItem(next, newParentId, adjustedIndex, node);
}

export function moveItem(items: MenuItem[], id: string, dir: -1 | 1): MenuItem[] {
  const path = findItemPath(items, id);
  if (!path) return items;

  const index = path[path.length - 1]!;
  const swap = index + dir;
  const parentPath = path.slice(0, -1);

  if (parentPath.length === 0) {
    if (swap < 0 || swap >= items.length) return items;
    const next = [...items];
    [next[index], next[swap]] = [next[swap]!, next[index]!];
    return next;
  }

  return setAtPath(items, parentPath, (parent) => {
    const children = [...(parent.children ?? [])];
    if (swap < 0 || swap >= children.length) return parent;
    [children[index], children[swap]] = [children[swap]!, children[index]!];
    return { ...parent, children };
  });
}

/** Become the last child of the previous sibling. No-op for the first item at its level. */
export function indentItem(items: MenuItem[], id: string): MenuItem[] {
  const path = findItemPath(items, id);
  if (!path) return items;
  const index = path[path.length - 1]!;
  if (index === 0) return items;

  const parentPath = path.slice(0, -1);
  const siblings = parentPath.length === 0 ? items : getItemAtPath(items, parentPath)?.children ?? [];
  const newParent = siblings[index - 1];
  if (!newParent) return items;

  const newIndex = newParent.children?.length ?? 0;
  return moveItemTo(items, id, newParent.id, newIndex);
}

/** Become the next sibling of the parent. No-op for a top-level item. */
export function outdentItem(items: MenuItem[], id: string): MenuItem[] {
  const path = findItemPath(items, id);
  if (!path || path.length < 2) return items;

  const parentPath = path.slice(0, -1);
  const parent = getItemAtPath(items, parentPath);
  if (!parent) return items;

  const grandParentPath = parentPath.slice(0, -1);
  const grandParentId = grandParentPath.length === 0 ? null : getItemAtPath(items, grandParentPath)?.id ?? null;
  const parentIndexAtItsLevel = parentPath[parentPath.length - 1]!;

  return moveItemTo(items, id, grandParentId, parentIndexAtItsLevel + 1);
}

/** Deep-clone `id` (fresh ids throughout) and insert the copy right after it, at the same level. */
export function duplicateItem(items: MenuItem[], id: string): { items: MenuItem[]; newId: string } {
  const path = findItemPath(items, id);
  if (!path) return { items, newId: id };
  const node = getItemAtPath(items, path);
  if (!node) return { items, newId: id };

  const copy = reassignIds(node);
  const parentPath = path.slice(0, -1);
  const parentId = parentPath.length === 0 ? null : getItemAtPath(items, parentPath)?.id ?? null;
  const index = path[path.length - 1]!;

  return { items: insertItem(items, parentId, index + 1, copy), newId: copy.id };
}

export function flattenItems(
  items: MenuItem[],
  depth = 0,
): Array<{ item: MenuItem; depth: number; path: MenuItemPath }> {
  const out: Array<{ item: MenuItem; depth: number; path: MenuItemPath }> = [];
  items.forEach((item, i) => {
    out.push({ item, depth, path: [i] });
    if (item.children?.length) {
      out.push(
        ...flattenItems(item.children, depth + 1).map((entry) => ({
          ...entry,
          path: [i, ...entry.path],
        })),
      );
    }
  });
  return out;
}
