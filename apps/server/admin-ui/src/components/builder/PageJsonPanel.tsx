import { useEffect, useMemo, useState } from "react";
import { useT } from "../../i18n/I18nProvider";
import { formatPageJson, parsePageJson } from "./block-json";
import { parsePageHeader, type PageHeaderConfig } from "../../lib/page-header";
import type { BlockNode } from "./types";

/**
 * The whole page as JSON, shown in the inspector when no block is selected.
 *
 * The draft mirrors the canvas until the editor types into it, then holds
 * still — so dragging a block around keeps the JSON current, but a half-written
 * edit is never overwritten from underneath. Reload gives up the draft.
 */
export default function PageJsonPanel({
  blocks,
  header,
  compact = false,
  onApply,
}: {
  blocks: BlockNode[];
  /** Omitted when this builder does not edit header chrome. */
  header?: PageHeaderConfig;
  compact?: boolean;
  onApply: (next: { blocks: BlockNode[]; header?: PageHeaderConfig }) => void;
}) {
  const { t } = useT();
  const live = useMemo(() => formatPageJson(blocks, header), [blocks, header]);

  const [seeded, setSeeded] = useState(live);
  const [draft, setDraft] = useState(live);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(false);

  const dirty = draft !== seeded;
  const stale = dirty && seeded !== live;

  useEffect(() => {
    if (dirty) return;
    setSeeded(live);
    setDraft(live);
  }, [live, dirty]);

  function reload() {
    setSeeded(live);
    setDraft(live);
    setError("");
    setApplied(false);
  }

  function apply() {
    try {
      const parsed = parsePageJson(draft);
      onApply({
        blocks: parsed.blocks,
        ...(header && parsed.header !== undefined ? { header: parsePageHeader(parsed.header) } : {}),
      });
      setSeeded(draft);
      setError("");
      setApplied(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setApplied(false);
    }
  }

  return (
    <section className="jf-block-panel jf-block-panel--page" aria-labelledby="jf-page-json">
      <div className="jf-block-panel__head">
        <h3 id="jf-page-json">{t("builder.pageJson.title")}</h3>
        <span className="jf-block-panel__count">
          {t("builder.pageJson.count", { count: String(blocks.length) })}
        </span>
      </div>
      <p className="jf-block-panel__hint">{t("builder.pageJson.hint")}</p>

      <textarea
        className="jf-block-panel__code"
        rows={compact ? 12 : 22}
        value={draft}
        spellCheck={false}
        onChange={(e) => {
          setDraft(e.target.value);
          setApplied(false);
        }}
      />

      {error && <p className="jf-block-panel__error">{error}</p>}
      {stale && !error && <p className="jf-block-panel__warn">{t("builder.pageJson.stale")}</p>}

      <div className="jf-block-panel__actions">
        <button type="button" className="jf-block-panel__apply" disabled={!dirty} onClick={apply}>
          {t("builder.pageJson.apply")}
        </button>
        <button type="button" className="jf-block-panel__toggle" disabled={!dirty} onClick={reload}>
          {t("builder.pageJson.reload")}
        </button>
        {applied && <span className="jf-block-panel__ok">{t("builder.pageJson.applied")}</span>}
      </div>
    </section>
  );
}
