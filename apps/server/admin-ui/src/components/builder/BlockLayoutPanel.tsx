import {
  ALIGN_SELF,
  RADIUS_PRESETS,
  SHADOW_PRESETS,
  SPACE_STEPS,
  TEXT_ALIGN,
  WIDTH_PRESETS,
  compactBlockStyle,
  parseBlockStyle,
  type BlockStyle,
} from "@justflows/blocks";
import { useT } from "../../i18n/I18nProvider";
import type { BlockNode } from "./types";

const SPACE_LABELS: Record<string, string> = {
  "": "—", "0": "0", "1": "XXS", "2": "XS", "3": "S", "4": "M", "5": "L", "6": "XL", "7": "2XL", "8": "3XL",
};

/**
 * Spacing, size and alignment for any block.
 *
 * Every value is a step on the theme's scale rather than a raw length, so a
 * page keeps its rhythm and the whole site tightens up on a phone when the
 * scale does.
 */
export default function BlockLayoutPanel({
  block,
  onChange,
}: {
  block: BlockNode;
  onChange: (props: Record<string, unknown>) => void;
}) {
  const { t } = useT();
  const style = parseBlockStyle(block.props.style);

  function set(patch: Partial<BlockStyle>) {
    const props = { ...block.props };
    const next = compactBlockStyle(parseBlockStyle({ ...style, ...patch }));
    if (next) props.style = next;
    else delete props.style;
    onChange(props);
  }

  const spaceField = (label: string, key: keyof BlockStyle) => (
    <label className="jf-block-panel__field jf-block-panel__field--inline">
      {label}
      <select value={String(style[key])} onChange={(e) => set({ [key]: e.target.value } as Partial<BlockStyle>)}>
        {SPACE_STEPS.map((step) => (
          <option key={step} value={step}>{SPACE_LABELS[step] ?? step}</option>
        ))}
      </select>
    </label>
  );

  const choiceField = (label: string, key: keyof BlockStyle, options: readonly string[]) => (
    <label className="jf-block-panel__field jf-block-panel__field--inline">
      {label}
      <select value={String(style[key])} onChange={(e) => set({ [key]: e.target.value } as Partial<BlockStyle>)}>
        {options.map((value) => (
          <option key={value} value={value}>{value === "" ? "—" : t(`builder.layout.value.${value}`)}</option>
        ))}
      </select>
    </label>
  );

  return (
    <section className="jf-block-panel" aria-labelledby={`jf-layout-${block.id}`}>
      <h3 id={`jf-layout-${block.id}`}>{t("builder.layout.title")}</h3>
      <p className="jf-block-panel__hint">{t("builder.layout.hint")}</p>

      <div className="jf-block-panel__grid2">
        {spaceField(t("builder.layout.padTop"), "padTop")}
        {spaceField(t("builder.layout.padBottom"), "padBottom")}
        {spaceField(t("builder.layout.padX"), "padX")}
        {spaceField(t("builder.layout.marginTop"), "marginTop")}
        {spaceField(t("builder.layout.marginBottom"), "marginBottom")}
      </div>

      <div className="jf-block-panel__grid2">
        {choiceField(t("builder.layout.width"), "width", WIDTH_PRESETS)}
        {choiceField(t("builder.layout.alignSelf"), "alignSelf", ALIGN_SELF)}
        {choiceField(t("builder.layout.textAlign"), "textAlign", TEXT_ALIGN)}
        {choiceField(t("builder.layout.radius"), "radius", RADIUS_PRESETS)}
        {choiceField(t("builder.layout.shadow"), "shadow", SHADOW_PRESETS)}
        <label className="jf-block-panel__field jf-block-panel__field--inline">
          {t("builder.layout.minHeight")}
          <input
            type="number"
            min={0}
            max={100}
            value={style.minHeight}
            onChange={(e) => set({ minHeight: Number(e.target.value) || 0 })}
          />
        </label>
      </div>
    </section>
  );
}
