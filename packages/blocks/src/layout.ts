// SPDX-License-Identifier: MIT

/**
 * Where a block sits inside a grid parent.
 *
 * Placement lives on the child, not on the parent, because a CSS grid item is
 * positioned by its own `grid-column` / `grid-row`. That also means any block
 * type can be placed — there is no wrapper element to insert, and a block that
 * is not inside a grid simply carries declarations the browser ignores.
 */

export const GRID_MIN_COLUMNS = 2;
export const GRID_MAX_COLUMNS = 12;
export const GRID_DEFAULT_COLUMNS = 12;

/** Nothing narrower than half width once the viewport is tablet-sized. */
const TABLET_MIN_SPAN = 6;

export interface BlockPlacement {
  /** 1-based start column. */
  col: number;
  /** Width in columns. */
  span: number;
  /** 1-based row, or 0 to let the block flow into the next free cell. */
  row: number;
  /** Height in rows. */
  rowSpan: number;
}

export const DEFAULT_BLOCK_PLACEMENT: BlockPlacement = { col: 1, span: GRID_MAX_COLUMNS, row: 0, rowSpan: 1 };

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Coerce stored JSON into a placement. Unknown values become defaults. */
export function parseBlockPlacement(raw: unknown, columns = GRID_MAX_COLUMNS): BlockPlacement {
  const max = clampInt(columns, GRID_MAX_COLUMNS, GRID_MIN_COLUMNS, GRID_MAX_COLUMNS);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_BLOCK_PLACEMENT, span: max };
  }
  const input = raw as Record<string, unknown>;
  const col = clampInt(input["col"], 1, 1, max);
  return {
    col,
    // A block may not spill past the last column: the grid would add an
    // implicit one and every other row would silently widen.
    span: clampInt(input["span"], max - col + 1, 1, max - col + 1),
    row: clampInt(input["row"], 0, 0, 200),
    rowSpan: clampInt(input["rowSpan"], 1, 1, 20),
  };
}

export function isDefaultPlacement(placement: BlockPlacement, columns = GRID_MAX_COLUMNS): boolean {
  const max = clampInt(columns, GRID_MAX_COLUMNS, GRID_MIN_COLUMNS, GRID_MAX_COLUMNS);
  return placement.col === 1 && placement.span === max && placement.row === 0 && placement.rowSpan === 1;
}

/** Drop default values so stored block JSON stays small. */
export function compactBlockPlacement(
  placement: BlockPlacement,
  columns = GRID_MAX_COLUMNS,
): Record<string, unknown> | undefined {
  if (isDefaultPlacement(placement, columns)) return undefined;
  const out: Record<string, unknown> = { col: placement.col, span: placement.span };
  if (placement.row > 0) out["row"] = placement.row;
  if (placement.rowSpan > 1) out["rowSpan"] = placement.rowSpan;
  return out;
}

export function sanitizePlacementProp(raw: unknown): Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) return undefined;
  return compactBlockPlacement(parseBlockPlacement(raw));
}

/**
 * Placement used to live under the generic `layout` prop key — the same key
 * a block's own schema might use for something else entirely (the gallery
 * block's grid/masonry/carousel choice, for instance). Placement is always a
 * plain object; nothing else ever stored under `layout` is, so that shape is
 * what tells real legacy placement data apart from a block's own value. New
 * placement data is written under `gridPlacement` instead so the two can
 * never collide again; this only matters for reading data saved before that
 * split, or blocks that still write the old key.
 */
export function isPlacementShaped(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === "object" && !Array.isArray(raw);
}

/**
 * The custom properties the grid CSS reads.
 *
 * Rather than one value per breakpoint, narrow blocks are widened for tablet by
 * a fixed rule and everything goes full width on phones. That keeps placement a
 * single set of numbers an editor can reason about, and keeps a two-column
 * layout from turning into unreadable slivers on a small screen.
 */
export function placementStyleVars(placement: BlockPlacement): string {
  const vars = [
    `--jf-col:${placement.col}`,
    `--jf-span:${placement.span}`,
    `--jf-span-t:${Math.max(TABLET_MIN_SPAN, placement.span)}`,
  ];
  if (placement.row > 0) vars.push(`--jf-row:${placement.row}`);
  if (placement.rowSpan > 1) vars.push(`--jf-row-span:${placement.rowSpan}`);
  return vars.join(";");
}
