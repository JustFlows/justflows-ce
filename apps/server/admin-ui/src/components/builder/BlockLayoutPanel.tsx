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
  "": "—",
  "0": "0",
  "1": "XXS",
  "2": "XS",
  "3": "S",
  "4": "M",
  "5": "L",
  "6": "XL",
  "7": "2XL",
  "8": "3XL",
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
      <select
        value={String(style[key])}
        onChange={(e) => set({ [key]: e.target.value } as Partial<BlockStyle>)}
      >
        {SPACE_STEPS.map((step) => (
          <option key={step} value={step}>
            {SPACE_LABELS[step] ?? step}
          </option>
        ))}
      </select>
    </label>
  );

  const choiceField = (label: string, key: keyof BlockStyle, options: readonly string[]) => (
    <label className="jf-block-panel__field jf-block-panel__field--inline">
      {label}
      <select
        value={String(style[key])}
        onChange={(e) => set({ [key]: e.target.value } as Partial<BlockStyle>)}
      >
        {options.map((value) => (
          <option key={value} value={value}>
            {value === "" ? "—" : t(`builder.layout.value.${value}`)}
          </option>
        ))}
      </select>
    </label>
  );

  // Uses the generic `.jf-field` markup, not `.jf-block-panel__field`, so the
  // panel's `input { width: 100% }` rule does not stretch the colour swatch.
  const clearBtnStyle: React.CSSProperties = {
    flexShrink: 0,
    height: 34,
    padding: "0 0.5rem",
    border: "1px solid var(--jf-border-strong)",
    borderRadius: "var(--jf-radius-sm)",
    background: "var(--jf-surface)",
    color: "var(--jf-text-3)",
    cursor: "pointer",
    fontSize: "0.8rem",
    lineHeight: 1,
    whiteSpace: "nowrap",
  };

  const colorField = (label: string, key: "background" | "textColor" | "accent") => {
    const current = String(style[key] ?? "");
    const id = `${block.id}-${key}`;
    const swatch = /^#[0-9a-fA-F]{6}$/.test(current) ? current : "#ffffff";
    const isNone = current === "transparent" || current === "none";
    return (
      <div className="jf-field" style={{ marginBottom: "0.6rem" }}>
        <label className="jf-field__label" htmlFor={id}>
          {label}
        </label>
        <div className="jf-row" style={{ flexWrap: "nowrap" }}>
          <input
            id={id}
            type="color"
            className="jf-swatch"
            value={swatch}
            onChange={(e) => set({ [key]: e.target.value } as Partial<BlockStyle>)}
          />
          <input
            type="text"
            className="jf-input jf-input--mono"
            placeholder={t("builder.layout.auto")}
            value={current}
            spellCheck={false}
            onChange={(e) => set({ [key]: e.target.value } as Partial<BlockStyle>)}
          />
          {key === "background" ? (
            <button
              type="button"
              aria-pressed={isNone}
              onClick={() =>
                set({ background: isNone ? "" : "transparent" } as Partial<BlockStyle>)
              }
              style={{
                ...clearBtnStyle,
                background: isNone ? "var(--jf-accent-soft)" : "var(--jf-surface)",
                color: isNone ? "var(--jf-accent)" : "var(--jf-text-3)",
              }}
              title={t("builder.layout.transparentHint")}
            >
              {t("builder.layout.transparent")}
            </button>
          ) : null}
          {current && !isNone ? (
            <button
              type="button"
              aria-label={`Clear ${label}`}
              onClick={() => set({ [key]: "" } as Partial<BlockStyle>)}
              style={{ ...clearBtnStyle, width: 28, padding: 0, fontSize: "1rem" }}
            >
              ×
            </button>
          ) : null}
        </div>
      </div>
    );
  };

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
        {choiceField(t("builder.layout.widthPreset"), "width", WIDTH_PRESETS)}
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
        <label className="jf-block-panel__field jf-block-panel__field--inline">
          {t("builder.layout.maxWidth")}
          <input
            type="number"
            min={0}
            max={10000}
            placeholder={t("builder.layout.auto")}
            value={style.maxWidth || ""}
            onChange={(e) => set({ maxWidth: Number(e.target.value) || 0 })}
          />
        </label>
        <label className="jf-block-panel__field jf-block-panel__field--inline">
          {t("builder.layout.maxHeight")}
          <input
            type="number"
            min={0}
            max={10000}
            placeholder={t("builder.layout.auto")}
            value={style.maxHeight || ""}
            onChange={(e) => set({ maxHeight: Number(e.target.value) || 0 })}
          />
        </label>
      </div>

      <div style={{ marginTop: "0.25rem" }}>
        {colorField(t("builder.layout.background"), "background")}
        {colorField(t("builder.layout.textColor"), "textColor")}
        {colorField(t("builder.layout.accent"), "accent")}

        <div className="jf-field" style={{ marginBottom: "0.6rem" }}>
          <label className="jf-field__label" htmlFor={`${block.id}-opacity`}>
            {t("builder.layout.opacity")}:{" "}
            {style.opacity ? `${style.opacity}%` : t("builder.layout.auto")}
          </label>
          <div className="jf-row" style={{ flexWrap: "nowrap" }}>
            <input
              id={`${block.id}-opacity`}
              type="range"
              min={0}
              max={100}
              step={5}
              value={style.opacity ? Number(style.opacity) : 100}
              onChange={(e) => {
                const v = Number(e.target.value);
                set({ opacity: v >= 100 ? "" : String(v) } as Partial<BlockStyle>);
              }}
            />
            {style.opacity ? (
              <button
                type="button"
                aria-label={`Clear ${t("builder.layout.opacity")}`}
                onClick={() => set({ opacity: "" } as Partial<BlockStyle>)}
                style={{ ...clearBtnStyle, width: 28, padding: 0, fontSize: "1rem" }}
              >
                ×
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
