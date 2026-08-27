import { useCallback, useEffect, useState } from "react";
import { useT } from "../../i18n/I18nProvider";
import { useSessionRole } from "@components/SessionProvider";
import type { BlockNode } from "./types";

export interface ReusableItem {
  id: string;
  name: string;
  updatedAt: string;
}

/** Shared loader so the inspector and the library see the same list. */
export function useReusableBlocks() {
  const [items, setItems] = useState<ReusableItem[]>([]);

  const reload = useCallback(() => {
    fetch("/api/reusable-blocks")
      .then((r) => r.json())
      .then((body: { items?: ReusableItem[] }) => setItems(body.items ?? []))
      .catch(() => setItems([]));
  }, []);

  useEffect(reload, [reload]);
  return { items, reload };
}

/**
 * Save the selected block to the library, or point it at a saved one.
 *
 * Saving stores a copy and leaves the block where it is; converting replaces it
 * with a reference, which is what makes later edits propagate.
 */
export default function ReusablePanel({
  block,
  onConvert,
  onReload,
  items,
}: {
  block: BlockNode;
  onConvert: (ref: string) => void;
  onReload: () => void;
  items: ReusableItem[];
}) {
  const { t } = useT();
  // Saving to the reusable-block library is administrator/editor-only on the
  // server; switching a reference between already-saved blocks (below) isn't
  // a write to that library, so it stays open to any content-write role.
  const role = useSessionRole();
  const canSaveReusable = role === "administrator" || role === "editor";
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isReference = block.type === "core.reusable";
  const currentRef = typeof block.props.ref === "string" ? block.props.ref : "";

  async function save(convert: boolean) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/reusable-blocks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || undefined, blocks: [block] }),
      });
      const body = await res.json() as { error?: string; item?: ReusableItem };
      if (!res.ok || !body.item) throw new Error(body.error ?? "Could not save");
      onReload();
      setName("");
      if (convert) onConvert(body.item.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (isReference) {
    const target = items.find((item) => item.id === currentRef);
    return (
      <section className="jf-block-panel" aria-labelledby={`jf-reuse-${block.id}`}>
        <h3 id={`jf-reuse-${block.id}`}>{t("builder.reusable.title")}</h3>
        <p className="jf-block-panel__hint">{t("builder.reusable.referenceHint")}</p>
        <label className="jf-block-panel__field">
          {t("builder.reusable.showing")}
          <select value={currentRef} onChange={(e) => onConvert(e.target.value)}>
            <option value="">—</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        {currentRef && !target && (
          <p className="jf-block-panel__error">{t("builder.reusable.missing")}</p>
        )}
      </section>
    );
  }

  if (!canSaveReusable) return null;

  return (
    <section className="jf-block-panel" aria-labelledby={`jf-reuse-${block.id}`}>
      <h3 id={`jf-reuse-${block.id}`}>{t("builder.reusable.title")}</h3>
      <p className="jf-block-panel__hint">{t("builder.reusable.hint")}</p>
      <label className="jf-block-panel__field">
        {t("builder.reusable.name")}
        <input
          type="text"
          value={name}
          placeholder={t("builder.reusable.namePlaceholder")}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {error && <p className="jf-block-panel__error">{error}</p>}
      <div className="jf-block-panel__actions">
        <button type="button" className="jf-block-panel__apply" disabled={busy} onClick={() => void save(true)}>
          {t("builder.reusable.saveAndLink")}
        </button>
        <button type="button" className="jf-block-panel__toggle" disabled={busy} onClick={() => void save(false)}>
          {t("builder.reusable.saveCopy")}
        </button>
      </div>
    </section>
  );
}
