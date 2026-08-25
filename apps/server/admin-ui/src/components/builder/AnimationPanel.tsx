import {
  ANIMATION_EASINGS,
  ANIMATION_TRIGGERS,
  HOVER_EFFECTS,
  TAP_EFFECTS,
  compactBlockAnimation,
  parseBlockAnimation,
  type AnimationEasing,
  type AnimationTrigger,
  type BlockAnimation,
  type EntranceEffect,
  type HoverEffect,
  type TapEffect,
} from "@justflows/blocks";
import { useT } from "../../i18n/I18nProvider";
import { dispatchPreviewAnimation } from "./MotionPreview";

const FADE_EFFECTS: EntranceEffect[] = ["fade", "fade-up", "fade-down", "fade-left", "fade-right"];
const SLIDE_EFFECTS: EntranceEffect[] = ["slide-up", "slide-down", "slide-left", "slide-right"];
const SCALE_EFFECTS: EntranceEffect[] = ["zoom-in", "zoom-out", "bounce"];
const EXTRA_EFFECTS: EntranceEffect[] = ["flip-x", "flip-y", "rotate", "blur"];

export default function AnimationPanel({
  blockId,
  value,
  onChange,
}: {
  blockId: string;
  value: unknown;
  onChange: (animation: Record<string, unknown> | undefined) => void;
}) {
  const { t } = useT();
  const anim = parseBlockAnimation(value);

  function commit(patch: Partial<BlockAnimation>) {
    onChange(compactBlockAnimation({ ...anim, ...patch }));
  }

  return (
    <section className="jf-anim-panel" aria-labelledby={`jf-anim-${blockId}`}>
      <div className="jf-anim-panel__head">
        <h3 id={`jf-anim-${blockId}`}>{t("builder.animation.title")}</h3>
        {anim.entrance !== "none" && (
          <button type="button" className="jf-anim-panel__replay" onClick={() => dispatchPreviewAnimation(blockId)}>
            {t("builder.animation.replay")}
          </button>
        )}
      </div>
      <p className="jf-anim-panel__hint">{t("builder.animation.hint")}</p>

      <label className="jf-anim-panel__field">
        {t("builder.animation.entrance")}
        <select value={anim.entrance} onChange={(e) => commit({ entrance: e.target.value as EntranceEffect })}>
          <option value="none">{t("builder.animation.effects.none")}</option>
          <optgroup label={t("builder.animation.groups.fade")}>
            {FADE_EFFECTS.map((id) => <option key={id} value={id}>{t(`builder.animation.effects.${id}`)}</option>)}
          </optgroup>
          <optgroup label={t("builder.animation.groups.slide")}>
            {SLIDE_EFFECTS.map((id) => <option key={id} value={id}>{t(`builder.animation.effects.${id}`)}</option>)}
          </optgroup>
          <optgroup label={t("builder.animation.groups.scale")}>
            {SCALE_EFFECTS.map((id) => <option key={id} value={id}>{t(`builder.animation.effects.${id}`)}</option>)}
          </optgroup>
          <optgroup label={t("builder.animation.groups.extra")}>
            {EXTRA_EFFECTS.map((id) => <option key={id} value={id}>{t(`builder.animation.effects.${id}`)}</option>)}
          </optgroup>
        </select>
      </label>

      {anim.entrance !== "none" && (
        <>
          <label className="jf-anim-panel__field">
            {t("builder.animation.trigger")}
            <select value={anim.trigger} onChange={(e) => commit({ trigger: e.target.value as AnimationTrigger })}>
              {ANIMATION_TRIGGERS.map((id) => (
                <option key={id} value={id}>{t(`builder.animation.triggers.${id}`)}</option>
              ))}
            </select>
          </label>
          <label className="jf-anim-panel__field">
            {t("builder.animation.duration")}
            <span className="jf-anim-panel__range">
              <input type="range" min={0.15} max={2.5} step={0.05} value={anim.duration} onChange={(e) => commit({ duration: Number(e.target.value) })} />
              <span>{anim.duration.toFixed(2)}s</span>
            </span>
          </label>
          <label className="jf-anim-panel__field">
            {t("builder.animation.delay")}
            <span className="jf-anim-panel__range">
              <input type="range" min={0} max={2} step={0.05} value={anim.delay} onChange={(e) => commit({ delay: Number(e.target.value) })} />
              <span>{anim.delay.toFixed(2)}s</span>
            </span>
          </label>
          <label className="jf-anim-panel__field">
            {t("builder.animation.easing")}
            <select value={anim.easing} onChange={(e) => commit({ easing: e.target.value as AnimationEasing })}>
              {ANIMATION_EASINGS.map((id) => (
                <option key={id} value={id}>{t(`builder.animation.easings.${id}`)}</option>
              ))}
            </select>
          </label>
          {anim.trigger === "in-view" && (
            <label className="jf-anim-panel__check">
              <input type="checkbox" checked={anim.once} onChange={(e) => commit({ once: e.target.checked })} />
              {t("builder.animation.once")}
            </label>
          )}
        </>
      )}

      <label className="jf-anim-panel__field">
        {t("builder.animation.hover")}
        <select value={anim.hover} onChange={(e) => commit({ hover: e.target.value as HoverEffect })}>
          {HOVER_EFFECTS.map((id) => (
            <option key={id} value={id}>{t(`builder.animation.hoverEffects.${id}`)}</option>
          ))}
        </select>
      </label>
      <label className="jf-anim-panel__field">
        {t("builder.animation.tap")}
        <select value={anim.tap} onChange={(e) => commit({ tap: e.target.value as TapEffect })}>
          {TAP_EFFECTS.map((id) => (
            <option key={id} value={id}>{t(`builder.animation.tapEffects.${id}`)}</option>
          ))}
        </select>
      </label>
    </section>
  );
}
