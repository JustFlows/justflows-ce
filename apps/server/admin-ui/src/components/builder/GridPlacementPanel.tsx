import { compactBlockPlacement, isPlacementShaped, parseBlockPlacement } from "@justflows/blocks";
import { useT } from "../../i18n/I18nProvider";
import type { BlockNode } from "./types";

/**
 * Exact placement for a block inside a grid.
 *
 * Dragging is faster for roughing a layout out; typing is faster for making two
 * blocks line up exactly. Both write the same prop.
 */
export default function GridPlacementPanel({
  block,
  columns,
  onChange,
}: {
  block: BlockNode;
  columns: number;
  onChange: (props: Record<string, unknown>) => void;
}) {
  const { t } = useT();
  const placementSource = block.props.gridPlacement ?? (isPlacementShaped(block.props.layout) ? block.props.layout : undefined);
  const placement = parseBlockPlacement(placementSource, columns);

  function set(patch: Partial<typeof placement>) {
    const next = parseBlockPlacement({ ...placement, ...patch }, columns);
    const props = { ...block.props };
    const compacted = compactBlockPlacement(next, columns);
    if (compacted) props.gridPlacement = compacted;
    else delete props.gridPlacement;
    // Clean up legacy placement data stored under the old shared key so it
    // doesn't linger duplicated once this block has been re-placed.
    if (isPlacementShaped(props.layout)) delete props.layout;
    onChange(props);
  }

  const field = (
    label: string,
    value: number,
    min: number,
    max: number,
    apply: (n: number) => void,
  ) => (
    <label className="jf-block-panel__field jf-block-panel__field--inline">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) apply(n);
        }}
      />
    </label>
  );

  return (
    <section className="jf-block-panel" aria-labelledby={`jf-place-${block.id}`}>
      <h3 id={`jf-place-${block.id}`}>{t("builder.placement.title")}</h3>
      <p className="jf-block-panel__hint">{t("builder.placement.hint", { columns: String(columns) })}</p>

      <div className="jf-block-panel__grid2">
        {field(t("builder.placement.col"), placement.col, 1, columns, (n) => set({ col: n }))}
        {field(t("builder.placement.span"), placement.span, 1, columns, (n) => set({ span: n }))}
        {field(t("builder.placement.row"), placement.row, 0, 200, (n) => set({ row: n }))}
        {field(t("builder.placement.rowSpan"), placement.rowSpan, 1, 20, (n) => set({ rowSpan: n }))}
      </div>

      <div className="jf-block-panel__actions">
        <button type="button" className="jf-block-panel__toggle" onClick={() => set({ col: 1, span: columns })}>
          {t("builder.placement.fullWidth")}
        </button>
        <button type="button" className="jf-block-panel__toggle" onClick={() => set({ row: 0 })}>
          {t("builder.placement.autoRow")}
        </button>
      </div>
    </section>
  );
}
