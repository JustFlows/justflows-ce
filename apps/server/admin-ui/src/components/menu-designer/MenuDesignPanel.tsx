import { useT } from "../../i18n/I18nProvider";

export interface MenuDesign {
  layout: "horizontal" | "vertical" | "dropdown" | "multi-level-dropdown" | "mega" | "footer" | "drawer";
  activation: "hover" | "click" | "both";
  breakpoint: number;
  mobilePattern: "dropdown" | "accordion" | "drawer-right" | "drawer-left" | "fullscreen";
  mobileMotion: "slide" | "fade" | "none";
  mobileMotionMs: number;
  alignment: "start" | "center" | "end" | "space-between";
  maxDepth: number;
  maxItemsPerLevel: number;
  presetId?: string;
}

export interface MenuDesignPreset {
  id: string;
  name: string;
  description?: string;
  design: MenuDesign;
}

const LAYOUTS: Array<{ value: MenuDesign["layout"]; labelKey: string; hintKey: string }> = [
  { value: "horizontal", labelKey: "menus.layout.horizontal", hintKey: "menus.layout.horizontalHint" },
  { value: "vertical", labelKey: "menus.layout.vertical", hintKey: "menus.layout.verticalHint" },
  { value: "dropdown", labelKey: "menus.layout.dropdown", hintKey: "menus.layout.dropdownHint" },
  { value: "multi-level-dropdown", labelKey: "menus.layout.multiLevelDropdown", hintKey: "menus.layout.multiLevelDropdownHint" },
  { value: "mega", labelKey: "menus.layout.mega", hintKey: "menus.layout.megaHint" },
  { value: "footer", labelKey: "menus.layout.footer", hintKey: "menus.layout.footerHint" },
  { value: "drawer", labelKey: "menus.layout.drawer", hintKey: "menus.layout.drawerHint" },
];

interface MenuDesignPanelProps {
  design: MenuDesign;
  presets: MenuDesignPreset[];
  onChange: (design: MenuDesign) => void;
}

export default function MenuDesignPanel({ design, presets, onChange }: MenuDesignPanelProps) {
  const { t } = useT();

  function update(patch: Partial<MenuDesign>) {
    onChange({ ...design, ...patch, presetId: "" });
  }

  return (
    <div className="jf-card">
      <div className="jf-card__head">
        <h2 className="jf-card__title">{t("menus.design.title")}</h2>
      </div>
      <div className="jf-card__body jf-stack">
        {presets.length > 0 && (
          <div className="jf-field">
            <span className="jf-field__label">{t("menus.design.presets")}</span>
            <div className="jf-filterbar">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="jf-chip"
                  aria-pressed={design.presetId === preset.id}
                  title={preset.description}
                  onClick={() => onChange({ ...preset.design, presetId: preset.id })}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="jf-field">
          <span className="jf-field__label">{t("menus.design.layout")}</span>
          <div className="jf-menu-layout-grid">
            {LAYOUTS.map((layout) => (
              <button
                key={layout.value}
                type="button"
                className="jf-menu-layout-card"
                aria-pressed={design.layout === layout.value}
                onClick={() => update({ layout: layout.value })}
              >
                <span className="jf-menu-layout-card__name">{t(layout.labelKey)}</span>
                <span className="jf-menu-layout-card__hint">{t(layout.hintKey)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="jf-field">
          <label className="jf-field__label" htmlFor="jf-design-activation">{t("menus.design.activation")}</label>
          <select
            id="jf-design-activation"
            className="jf-input"
            value={design.activation}
            onChange={(e) => update({ activation: e.target.value as MenuDesign["activation"] })}
          >
            <option value="hover">{t("menus.design.activationHover")}</option>
            <option value="click">{t("menus.design.activationClick")}</option>
            <option value="both">{t("menus.design.activationBoth")}</option>
          </select>
        </div>

        <div className="jf-field">
          <label className="jf-field__label" htmlFor="jf-design-align">{t("menus.design.alignment")}</label>
          <select
            id="jf-design-align"
            className="jf-input"
            value={design.alignment}
            onChange={(e) => update({ alignment: e.target.value as MenuDesign["alignment"] })}
          >
            <option value="start">{t("menus.dropdown.alignStart")}</option>
            <option value="center">{t("menus.dropdown.alignCenter")}</option>
            <option value="end">{t("menus.dropdown.alignEnd")}</option>
            <option value="space-between">{t("menus.design.alignmentSpaceBetween")}</option>
          </select>
        </div>

        <div className="jf-field">
          <label className="jf-field__label" htmlFor="jf-design-mobile">{t("menus.design.mobilePattern")}</label>
          <select
            id="jf-design-mobile"
            className="jf-input"
            value={design.mobilePattern}
            onChange={(e) => update({ mobilePattern: e.target.value as MenuDesign["mobilePattern"] })}
          >
            <option value="drawer-right">{t("menus.design.mobileDrawerRight")}</option>
            <option value="drawer-left">{t("menus.design.mobileDrawerLeft")}</option>
            <option value="dropdown">{t("menus.design.mobileDropdown")}</option>
            <option value="fullscreen">{t("menus.design.mobileFullscreen")}</option>
            <option value="accordion">{t("menus.design.mobileAccordion")}</option>
          </select>
          <p className="jf-field__hint">{t("menus.design.mobilePatternHint")}</p>
        </div>

        <div className="jf-field">
          <label className="jf-field__label" htmlFor="jf-design-motion">{t("menus.design.mobileMotion")}</label>
          <select
            id="jf-design-motion"
            className="jf-input"
            value={design.mobileMotion ?? "slide"}
            onChange={(e) => update({ mobileMotion: e.target.value as MenuDesign["mobileMotion"] })}
          >
            <option value="slide">{t("menus.design.mobileMotionSlide")}</option>
            <option value="fade">{t("menus.design.mobileMotionFade")}</option>
            <option value="none">{t("menus.design.mobileMotionNone")}</option>
          </select>
          <p className="jf-field__hint">{t("menus.design.mobileMotionHint")}</p>
        </div>

        {(design.mobileMotion ?? "slide") !== "none" && (
          <div className="jf-field">
            <label className="jf-field__label" htmlFor="jf-design-motion-ms">
              {t("menus.design.mobileMotionMs")}: {design.mobileMotionMs ?? 240}ms
            </label>
            <input
              id="jf-design-motion-ms"
              type="range"
              min={120}
              max={800}
              step={20}
              value={design.mobileMotionMs ?? 240}
              onChange={(e) => update({ mobileMotionMs: Number(e.target.value) })}
            />
          </div>
        )}

        <div className="jf-field">
          <label className="jf-field__label" htmlFor="jf-design-breakpoint">
            {t("menus.design.breakpoint")}: {design.breakpoint}px
          </label>
          <input
            id="jf-design-breakpoint"
            type="range"
            min={320}
            max={1400}
            step={10}
            value={design.breakpoint}
            onChange={(e) => update({ breakpoint: Number(e.target.value) })}
          />
        </div>

        <div className="jf-row">
          <div className="jf-field" style={{ flex: 1 }}>
            <label className="jf-field__label" htmlFor="jf-design-max-depth">{t("menus.design.maxDepth")}</label>
            <input
              id="jf-design-max-depth"
              type="number"
              min={1}
              max={4}
              className="jf-input"
              value={design.maxDepth}
              onChange={(e) => update({ maxDepth: Math.min(4, Math.max(1, Number(e.target.value) || 1)) })}
            />
          </div>
          <div className="jf-field" style={{ flex: 1 }}>
            <label className="jf-field__label" htmlFor="jf-design-max-items">{t("menus.design.maxItemsPerLevel")}</label>
            <input
              id="jf-design-max-items"
              type="number"
              min={1}
              max={40}
              className="jf-input"
              value={design.maxItemsPerLevel}
              onChange={(e) => update({ maxItemsPerLevel: Math.min(40, Math.max(1, Number(e.target.value) || 1)) })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
