import { useState } from "react";
import { useT } from "../../i18n/I18nProvider";
import { formatBlockNodeJson, parseBlockNodeJson } from "./block-json";
import type { BlockNode } from "./types";

/**
 * Edit one block as JSON.
 *
 * The draft is seeded when the panel opens rather than mirrored continuously,
 * so editing a field elsewhere in the inspector cannot overwrite half-typed
 * JSON. Reload picks up whatever the block looks like now.
 */
export default function BlockJsonPanel({
  block,
  onApply,
}: {
  block: BlockNode;
  onApply: (block: BlockNode) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(false);

  function seed() {
    setDraft(formatBlockNodeJson(block));
    setError("");
    setApplied(false);
  }

  function toggle() {
    if (!open) seed();
    setOpen(!open);
  }

  function apply() {
    try {
      onApply(parseBlockNodeJson(draft, block));
      setError("");
      setApplied(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setApplied(false);
    }
  }

  return (
    <section className="jf-block-panel" aria-labelledby={`jf-json-${block.id}`}>
      <div className="jf-block-panel__head">
        <h3 id={`jf-json-${block.id}`}>{t("builder.json.title")}</h3>
        <button type="button" className="jf-block-panel__toggle" aria-expanded={open} onClick={toggle}>
          {open ? t("builder.json.hide") : t("builder.json.edit")}
        </button>
      </div>

      {open && (
        <>
          <p className="jf-block-panel__hint">{t("builder.json.hint")}</p>
          <textarea
            className="jf-block-panel__code"
            rows={14}
            value={draft}
            spellCheck={false}
            onChange={(e) => {
              setDraft(e.target.value);
              setApplied(false);
            }}
          />
          {error && <p className="jf-block-panel__error">{error}</p>}
          <div className="jf-block-panel__actions">
            <button type="button" className="jf-block-panel__apply" onClick={apply}>
              {t("builder.json.apply")}
            </button>
            <button type="button" className="jf-block-panel__toggle" onClick={seed}>
              {t("builder.json.reload")}
            </button>
            {applied && <span className="jf-block-panel__ok">{t("builder.json.applied")}</span>}
          </div>
        </>
      )}
    </section>
  );
}
