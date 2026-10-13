// SPDX-License-Identifier: MIT

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { useT } from "../i18n/I18nProvider";
import { termTree, type Taxonomy, type Term, type TermRef } from "../lib/taxonomies";

export interface ContentTermsPanelHandle {
  /** Persist changed assignments; resolves false (and reports through onError) when the save fails. */
  save(): Promise<boolean>;
}

type Selection = Record<string, string[]>;

function sameSelection(a: Selection, b: Selection): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = [...(a[key] ?? [])].sort().join(",");
    const right = [...(b[key] ?? [])].sort().join(",");
    if (left !== right) return false;
  }
  return true;
}

/** Category, tag and custom-taxonomy pickers for one entry, saved with the entry. */
const ContentTermsPanel = forwardRef<
  ContentTermsPanelHandle,
  {
    contentId: string;
    contentType: string;
    /** Roles that may create terms inline (server-enforced: content:publish). */
    canCreateTerms: boolean;
    disabled?: boolean;
    onDirty(dirty: boolean): void;
    onError(message: string): void;
  }
>(function ContentTermsPanel({ contentId, contentType, canCreateTerms, disabled, onDirty, onError }, ref) {
  const { t } = useT();
  const [taxonomies, setTaxonomies] = useState<Taxonomy[]>([]);
  const [terms, setTerms] = useState<Record<string, Term[]>>({});
  const [selection, setSelection] = useState<Selection>({});
  const [baseline, setBaseline] = useState<Selection>({});
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [taxonomyRes, assignedRes] = await Promise.all([
        fetch("/api/taxonomies"),
        fetch(`/api/content/${contentId}/terms`),
      ]);
      if (!taxonomyRes.ok || !assignedRes.ok) return;
      const applicable = ((await taxonomyRes.json()) as { taxonomies?: Taxonomy[] }).taxonomies?.filter((taxonomy) =>
        taxonomy.contentTypes.includes(contentType),
      ) ?? [];
      const assigned = ((await assignedRes.json()) as { terms?: TermRef[] }).terms ?? [];
      const lists = await Promise.all(
        applicable.map(async (taxonomy) => {
          const res = await fetch(`/api/taxonomies/${encodeURIComponent(taxonomy.slug)}/terms`);
          const data = (await res.json().catch(() => ({}))) as { terms?: Term[] };
          return [taxonomy.slug, res.ok ? data.terms ?? [] : []] as const;
        }),
      );
      if (cancelled) return;
      const initial: Selection = {};
      for (const taxonomy of applicable)
        initial[taxonomy.slug] = assigned.filter((term) => term.taxonomy === taxonomy.slug).map((term) => term.id);
      setTaxonomies(applicable);
      setTerms(Object.fromEntries(lists));
      setSelection(initial);
      setBaseline(initial);
    })().catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [contentId, contentType]);

  const dirty = useMemo(() => !sameSelection(selection, baseline), [selection, baseline]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  useImperativeHandle(
    ref,
    () => ({
      async save() {
        if (!dirty) return true;
        const res = await fetch(`/api/content/${contentId}/terms`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ terms: selection }),
        });
        const data = (await res.json().catch(() => ({}))) as { terms?: TermRef[]; error?: string };
        if (!res.ok) {
          onError(data.error ?? t("taxonomies.assignFailed"));
          return false;
        }
        setBaseline(selection);
        return true;
      },
    }),
    [dirty, selection, contentId, onError, t],
  );

  function toggle(taxonomy: string, id: string, on: boolean) {
    setSelection((prev) => {
      const current = prev[taxonomy] ?? [];
      return { ...prev, [taxonomy]: on ? [...new Set([...current, id])] : current.filter((item) => item !== id) };
    });
  }

  async function addByName(taxonomy: Taxonomy) {
    const name = (inputs[taxonomy.slug] ?? "").trim();
    if (!name) return;
    const existing = (terms[taxonomy.slug] ?? []).find((term) => term.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      toggle(taxonomy.slug, existing.id, true);
      setInputs((prev) => ({ ...prev, [taxonomy.slug]: "" }));
      return;
    }
    if (!canCreateTerms) {
      onError(t("taxonomies.termNotFound", { name }));
      return;
    }
    setAdding(taxonomy.slug);
    try {
      const res = await fetch(`/api/taxonomies/${encodeURIComponent(taxonomy.slug)}/terms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json().catch(() => ({}))) as { term?: Term; error?: string };
      if (!res.ok || !data.term) {
        onError(data.error ?? t("taxonomies.saveFailed"));
        return;
      }
      setTerms((prev) => ({ ...prev, [taxonomy.slug]: [...(prev[taxonomy.slug] ?? []), data.term!] }));
      toggle(taxonomy.slug, data.term.id, true);
      setInputs((prev) => ({ ...prev, [taxonomy.slug]: "" }));
    } finally {
      setAdding(null);
    }
  }

  if (!taxonomies.length) return null;

  return (
    <>
      {taxonomies.map((taxonomy) => {
        const list = terms[taxonomy.slug] ?? [];
        const selected = new Set(selection[taxonomy.slug] ?? []);
        const byId = new Map(list.map((term) => [term.id, term]));
        const inputId = `jf-terms-${taxonomy.slug}`;
        return (
          <div className="jf-card" key={taxonomy.slug}>
            <div className="jf-card__head">
              <h2 className="jf-card__title">{taxonomy.name}</h2>
            </div>
            <div className="jf-card__body jf-stack">
              {taxonomy.hierarchical ? (
                list.length === 0 ? (
                  <p className="jf-field__hint" style={{ margin: 0 }}>{t("taxonomies.noTerms")}</p>
                ) : (
                  <div style={{ maxHeight: "14rem", overflowY: "auto" }}>
                    {termTree(list).map(({ term, depth }) => (
                      <label
                        key={term.id}
                        className="jf-row"
                        style={{ gap: "0.4rem", paddingInlineStart: `${depth * 1.1}rem`, marginBottom: "0.25rem" }}
                      >
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={selected.has(term.id)}
                          onChange={(e) => toggle(taxonomy.slug, term.id, e.target.checked)}
                        />
                        {term.name}
                      </label>
                    ))}
                  </div>
                )
              ) : (
                selected.size > 0 && (
                  <div className="jf-row" style={{ flexWrap: "wrap", gap: "0.35rem" }}>
                    {[...selected].map((id) => (
                      <span key={id} className="jf-badge" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                        {byId.get(id)?.name ?? id}
                        <button
                          type="button"
                          className="jf-btn jf-btn--ghost jf-btn--sm"
                          style={{ padding: "0 0.25rem", minHeight: 0 }}
                          disabled={disabled}
                          aria-label={t("taxonomies.removeTerm", { name: byId.get(id)?.name ?? id })}
                          onClick={() => toggle(taxonomy.slug, id, false)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )
              )}
              <div className="jf-field">
                <label className="jf-field__label" htmlFor={inputId}>
                  {canCreateTerms ? t("taxonomies.addOrCreate") : t("taxonomies.addExisting")}
                </label>
                <div className="jf-row">
                  <input
                    id={inputId}
                    className="jf-input"
                    list={`${inputId}-options`}
                    disabled={disabled || adding === taxonomy.slug}
                    value={inputs[taxonomy.slug] ?? ""}
                    onChange={(e) => setInputs((prev) => ({ ...prev, [taxonomy.slug]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addByName(taxonomy);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="jf-btn jf-btn--ghost"
                    disabled={disabled || adding === taxonomy.slug || !(inputs[taxonomy.slug] ?? "").trim()}
                    onClick={() => void addByName(taxonomy)}
                  >
                    {t("common.add")}
                  </button>
                </div>
                <datalist id={`${inputId}-options`}>
                  {list
                    .filter((term) => !selected.has(term.id))
                    .map((term) => (
                      <option key={term.id} value={term.name} />
                    ))}
                </datalist>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
});

export default ContentTermsPanel;
