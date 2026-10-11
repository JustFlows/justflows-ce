// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { initialJson } from "../../../ssr-data";
import { useSessionRole } from "@components/SessionProvider";
import { useT } from "../../../i18n/I18nProvider";
import { descendantIds, termTree, type Taxonomy, type Term } from "../../../lib/taxonomies";

interface ContentTypeSummary {
  slug: string;
  label: string;
}

type TermDraft = { name: string; slug: string; description: string; parentId: string };

const EMPTY_TERM: TermDraft = { name: "", slug: "", description: "", parentId: "" };

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? fallback);
  return data;
}

export default function TaxonomiesPage() {
  const { t } = useT();
  const role = useSessionRole();
  // Server-enforced: terms need content:publish, taxonomy definitions settings:manage.
  const canManageTerms = role === "administrator" || role === "editor";
  const canManageTaxonomies = role === "administrator";
  const prefetched = initialJson<{ taxonomies?: Taxonomy[] }>("/api/taxonomies");
  const [params, setParams] = useSearchParams();
  const [taxonomies, setTaxonomies] = useState<Taxonomy[]>(prefetched?.taxonomies ?? []);
  const [types, setTypes] = useState<ContentTypeSummary[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [loading, setLoading] = useState(!prefetched);
  const [termsLoading, setTermsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TermDraft>(EMPTY_TERM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<TermDraft>(EMPTY_TERM);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTaxonomy, setNewTaxonomy] = useState({ slug: "", name: "", hierarchical: false, contentTypes: [] as string[] });

  const selectedSlug = params.get("taxonomy") ?? taxonomies[0]?.slug ?? "category";
  const selected = taxonomies.find((taxonomy) => taxonomy.slug === selectedSlug) ?? taxonomies[0];
  const tree = useMemo(() => termTree(terms), [terms]);
  const typeLabels = useMemo(() => new Map(types.map((type) => [type.slug, type.label])), [types]);
  // Private types (the account page) cannot carry terms.
  const assignableTypes = types.filter((type) => type.slug !== "account");

  useEffect(() => {
    Promise.all([
      fetch("/api/taxonomies").then((res) => readJson<{ taxonomies: Taxonomy[] }>(res, t("taxonomies.loadFailed"))),
      fetch("/api/content-types").then((res) => readJson<{ types: ContentTypeSummary[] }>(res, t("taxonomies.loadFailed"))),
    ])
      .then(([taxonomyData, typeData]) => {
        setTaxonomies(taxonomyData.taxonomies ?? []);
        setTypes(typeData.types ?? []);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function loadTerms(slug: string) {
    setTermsLoading(true);
    try {
      const data = await readJson<{ terms: Term[] }>(
        await fetch(`/api/taxonomies/${encodeURIComponent(slug)}/terms`),
        t("taxonomies.loadFailed"),
      );
      setTerms(data.terms ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTermsLoading(false);
    }
  }

  useEffect(() => {
    if (!selected) return;
    setEditingId(null);
    setDraft(EMPTY_TERM);
    setSettingsOpen(false);
    void loadTerms(selected.slug);
  }, [selected?.slug]);

  async function run(action: () => Promise<void>) {
    setSaving(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function termBody(value: TermDraft, includeEmptySlug: boolean) {
    return {
      name: value.name.trim(),
      ...(value.slug.trim() || includeEmptySlug ? { slug: value.slug.trim() } : {}),
      description: value.description,
      ...(selected?.hierarchical ? { parentId: value.parentId || null } : {}),
    };
  }

  function addTerm() {
    if (!selected || !draft.name.trim()) return;
    void run(async () => {
      await readJson(
        await fetch(`/api/taxonomies/${encodeURIComponent(selected.slug)}/terms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(termBody(draft, false)),
        }),
        t("taxonomies.saveFailed"),
      );
      setDraft(EMPTY_TERM);
      await loadTerms(selected.slug);
    });
  }

  function startEdit(term: Term) {
    setEditingId(term.id);
    setEditDraft({ name: term.name, slug: term.slug, description: term.description, parentId: term.parentId ?? "" });
  }

  function saveEdit(term: Term) {
    if (!selected || !editDraft.name.trim() || !editDraft.slug.trim()) return;
    void run(async () => {
      await readJson(
        await fetch(`/api/taxonomies/${encodeURIComponent(selected.slug)}/terms/${term.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(termBody(editDraft, true)),
        }),
        t("taxonomies.saveFailed"),
      );
      setEditingId(null);
      await loadTerms(selected.slug);
    });
  }

  function removeTerm(term: Term) {
    if (!selected || !confirm(t("taxonomies.deleteTermConfirm", { name: term.name }))) return;
    void run(async () => {
      await readJson(
        await fetch(`/api/taxonomies/${encodeURIComponent(selected.slug)}/terms/${term.id}`, { method: "DELETE" }),
        t("taxonomies.deleteFailed"),
      );
      await loadTerms(selected.slug);
    });
  }

  function patchTaxonomy(taxonomy: Taxonomy, body: Partial<Pick<Taxonomy, "name" | "contentTypes">>) {
    void run(async () => {
      const data = await readJson<{ taxonomy: Taxonomy }>(
        await fetch(`/api/taxonomies/${encodeURIComponent(taxonomy.slug)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        t("taxonomies.saveFailed"),
      );
      setTaxonomies((prev) => prev.map((item) => (item.slug === taxonomy.slug ? data.taxonomy : item)));
    });
  }

  function removeTaxonomy(taxonomy: Taxonomy) {
    if (taxonomy.builtin || !confirm(t("taxonomies.deleteTaxonomyConfirm", { name: taxonomy.name }))) return;
    void run(async () => {
      await readJson(
        await fetch(`/api/taxonomies/${encodeURIComponent(taxonomy.slug)}`, { method: "DELETE" }),
        t("taxonomies.deleteFailed"),
      );
      setTaxonomies((prev) => prev.filter((item) => item.slug !== taxonomy.slug));
      setParams({});
    });
  }

  function createTaxonomy() {
    if (!newTaxonomy.slug || !newTaxonomy.name.trim()) return;
    void run(async () => {
      const data = await readJson<{ taxonomy: Taxonomy }>(
        await fetch("/api/taxonomies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newTaxonomy),
        }),
        t("taxonomies.createFailed"),
      );
      setTaxonomies((prev) => [...prev, data.taxonomy]);
      setCreating(false);
      setNewTaxonomy({ slug: "", name: "", hierarchical: false, contentTypes: [] });
      setParams({ taxonomy: data.taxonomy.slug });
    });
  }

  function toggleType(list: string[], slug: string, on: boolean): string[] {
    return on ? [...new Set([...list, slug])] : list.filter((item) => item !== slug);
  }

  function parentOptions(excluded: Set<string>) {
    return tree
      .filter(({ term }) => !excluded.has(term.id))
      .map(({ term, depth }) => (
        <option key={term.id} value={term.id}>
          {`${"— ".repeat(depth)}${term.name}`}
        </option>
      ));
  }

  if (loading) {
    return (
      <div className="jf-page" aria-busy="true">
        <p>{t("taxonomies.loading")}</p>
      </div>
    );
  }

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("taxonomies.heading")}</h1>
          <p>{t("taxonomies.subtitle")}</p>
        </div>
        {canManageTaxonomies && (
          <div className="jf-pagehead__actions">
            <button className="jf-btn jf-btn--ghost" onClick={() => setCreating(true)}>
              {t("taxonomies.newTaxonomy")}
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="jf-alert jf-alert--error" role="alert">
          {error}
        </div>
      )}

      {canManageTaxonomies && creating && (
        <div className="jf-card jf-card--active">
          <div className="jf-card__head">
            <h2 className="jf-card__title">{t("taxonomies.newTaxonomyHeading")}</h2>
          </div>
          <div className="jf-card__body jf-stack">
            <div className="jf-grid jf-grid--2">
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jf-tax-name">{t("taxonomies.nameLabel")}</label>
                <input
                  id="jf-tax-name"
                  className="jf-input"
                  placeholder={t("taxonomies.taxonomyNamePlaceholder")}
                  value={newTaxonomy.name}
                  onChange={(e) => setNewTaxonomy({ ...newTaxonomy, name: e.target.value })}
                />
              </div>
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jf-tax-slug">{t("taxonomies.slugLabel")}</label>
                <input
                  id="jf-tax-slug"
                  className="jf-input jf-input--mono"
                  placeholder={t("taxonomies.taxonomySlugPlaceholder")}
                  value={newTaxonomy.slug}
                  onChange={(e) =>
                    setNewTaxonomy({ ...newTaxonomy, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })
                  }
                />
                <span className="jf-field__hint">{t("taxonomies.taxonomySlugHint")}</span>
              </div>
            </div>
            <label className="jf-row" style={{ gap: "0.35rem" }}>
              <input
                type="checkbox"
                checked={newTaxonomy.hierarchical}
                onChange={(e) => setNewTaxonomy({ ...newTaxonomy, hierarchical: e.target.checked })}
              />
              {t("taxonomies.hierarchicalLabel")}
            </label>
            <fieldset className="jf-field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="jf-field__label">{t("taxonomies.contentTypesLabel")}</legend>
              <div className="jf-row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
                {assignableTypes.map((type) => (
                  <label key={type.slug} className="jf-row" style={{ gap: "0.35rem" }}>
                    <input
                      type="checkbox"
                      checked={newTaxonomy.contentTypes.includes(type.slug)}
                      onChange={(e) =>
                        setNewTaxonomy({
                          ...newTaxonomy,
                          contentTypes: toggleType(newTaxonomy.contentTypes, type.slug, e.target.checked),
                        })
                      }
                    />
                    {type.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="jf-row">
              <button className="jf-btn jf-btn--primary" disabled={saving} onClick={createTaxonomy}>
                {t("common.save")}
              </button>
              <button className="jf-btn jf-btn--ghost" onClick={() => setCreating(false)}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="jf-tabs" role="tablist" style={{ display: "flex", gap: "0.4rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {taxonomies.map((taxonomy) => (
          <button
            key={taxonomy.slug}
            type="button"
            role="tab"
            aria-selected={taxonomy.slug === selected?.slug}
            className={`jf-btn jf-btn--sm ${taxonomy.slug === selected?.slug ? "jf-btn--primary" : "jf-btn--ghost"}`}
            onClick={() => setParams({ taxonomy: taxonomy.slug })}
          >
            {taxonomy.name}
          </button>
        ))}
      </div>

      {selected && (
        <div className="jf-stack">
          <div className="jf-card">
            <div className="jf-card__head">
              <div style={{ minWidth: 0 }}>
                <div className="jf-row" style={{ gap: "0.5rem" }}>
                  <strong>{selected.name}</strong>
                  <code className="jf-code">{selected.slug}</code>
                  {selected.builtin && <span className="jf-badge">{t("taxonomies.builtinBadge")}</span>}
                </div>
                <p className="jf-list__desc">
                  {selected.contentTypes.length
                    ? t("taxonomies.usedBy", {
                        types: selected.contentTypes.map((slug) => typeLabels.get(slug) ?? slug).join(", "),
                      })
                    : t("taxonomies.usedByNone")}
                </p>
              </div>
              {canManageTaxonomies && (
                <div className="jf-row">
                  <button className="jf-btn jf-btn--ghost" onClick={() => setSettingsOpen(!settingsOpen)}>
                    {settingsOpen ? t("common.close") : t("taxonomies.editTaxonomy")}
                  </button>
                  {!selected.builtin && (
                    <button className="jf-btn jf-btn--danger" disabled={saving} onClick={() => removeTaxonomy(selected)}>
                      {t("common.delete")}
                    </button>
                  )}
                </div>
              )}
            </div>
            {canManageTaxonomies && settingsOpen && (
              <div className="jf-card__body jf-stack">
                <fieldset className="jf-field" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="jf-field__label">{t("taxonomies.contentTypesLabel")}</legend>
                  <div className="jf-row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
                    {assignableTypes.map((type) => (
                      <label key={type.slug} className="jf-row" style={{ gap: "0.35rem" }}>
                        <input
                          type="checkbox"
                          disabled={saving}
                          checked={selected.contentTypes.includes(type.slug)}
                          onChange={(e) =>
                            patchTaxonomy(selected, {
                              contentTypes: toggleType(selected.contentTypes, type.slug, e.target.checked),
                            })
                          }
                        />
                        {type.label}
                      </label>
                    ))}
                  </div>
                  <span className="jf-field__hint">{t("taxonomies.contentTypesHint")}</span>
                </fieldset>
              </div>
            )}
          </div>

          {canManageTerms && (
            <div className="jf-card">
              <div className="jf-card__head">
                <h2 className="jf-card__title">{t("taxonomies.addTerm")}</h2>
              </div>
              <form
                className="jf-card__body jf-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  addTerm();
                }}
              >
                <div className="jf-grid jf-grid--2">
                  <div className="jf-field">
                    <label className="jf-field__label" htmlFor="jf-term-name">{t("taxonomies.nameLabel")}</label>
                    <input
                      id="jf-term-name"
                      className="jf-input"
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </div>
                  <div className="jf-field">
                    <label className="jf-field__label" htmlFor="jf-term-slug">{t("taxonomies.slugLabel")}</label>
                    <input
                      id="jf-term-slug"
                      className="jf-input jf-input--mono"
                      placeholder={t("taxonomies.slugAutoPlaceholder")}
                      value={draft.slug}
                      onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase() })}
                    />
                  </div>
                </div>
                {selected.hierarchical && (
                  <div className="jf-field">
                    <label className="jf-field__label" htmlFor="jf-term-parent">{t("taxonomies.parentLabel")}</label>
                    <select
                      id="jf-term-parent"
                      className="jf-input"
                      value={draft.parentId}
                      onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}
                    >
                      <option value="">{t("taxonomies.noParent")}</option>
                      {parentOptions(new Set())}
                    </select>
                  </div>
                )}
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jf-term-desc">{t("taxonomies.descriptionLabel")}</label>
                  <input
                    id="jf-term-desc"
                    className="jf-input"
                    placeholder={t("taxonomies.optionalPlaceholder")}
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </div>
                <div className="jf-row">
                  <button type="submit" className="jf-btn jf-btn--primary" disabled={saving || !draft.name.trim()}>
                    {t("taxonomies.addTermButton")}
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="jf-card" aria-busy={termsLoading}>
            {!termsLoading && terms.length === 0 ? (
              <div className="jf-empty">
                <span className="jf-empty__icon" aria-hidden="true">🏷</span>
                <span className="jf-empty__title">{t("taxonomies.noTerms")}</span>
              </div>
            ) : (
              <div className="jf-tablewrap">
                <table className="jf-table">
                  <thead>
                    <tr>
                      <th>{t("taxonomies.nameLabel")}</th>
                      <th>{t("taxonomies.slugLabel")}</th>
                      <th>{t("taxonomies.countLabel")}</th>
                      {canManageTerms && <th style={{ textAlign: "end" }}>{t("common.actions")}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {tree.map(({ term, depth }) =>
                      editingId === term.id ? (
                        <tr key={term.id}>
                          <td colSpan={canManageTerms ? 4 : 3}>
                            <div className="jf-stack">
                              <div className="jf-grid jf-grid--2">
                                <input
                                  className="jf-input"
                                  aria-label={t("taxonomies.nameLabel")}
                                  value={editDraft.name}
                                  onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                                />
                                <input
                                  className="jf-input jf-input--mono"
                                  aria-label={t("taxonomies.slugLabel")}
                                  value={editDraft.slug}
                                  onChange={(e) => setEditDraft({ ...editDraft, slug: e.target.value.toLowerCase() })}
                                />
                              </div>
                              {selected.hierarchical && (
                                <select
                                  className="jf-input"
                                  aria-label={t("taxonomies.parentLabel")}
                                  value={editDraft.parentId}
                                  onChange={(e) => setEditDraft({ ...editDraft, parentId: e.target.value })}
                                >
                                  <option value="">{t("taxonomies.noParent")}</option>
                                  {parentOptions(new Set([term.id, ...descendantIds(terms, term.id)]))}
                                </select>
                              )}
                              <input
                                className="jf-input"
                                aria-label={t("taxonomies.descriptionLabel")}
                                placeholder={t("taxonomies.optionalPlaceholder")}
                                value={editDraft.description}
                                onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
                              />
                              {editDraft.slug !== term.slug && (
                                <span className="jf-field__hint">{t("taxonomies.slugChangeHint")}</span>
                              )}
                              <div className="jf-row">
                                <button
                                  className="jf-btn jf-btn--primary"
                                  disabled={saving || !editDraft.name.trim() || !editDraft.slug.trim()}
                                  onClick={() => saveEdit(term)}
                                >
                                  {saving ? t("common.saving") : t("common.save")}
                                </button>
                                <button className="jf-btn jf-btn--ghost" onClick={() => setEditingId(null)}>
                                  {t("common.cancel")}
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={term.id}>
                          <td className="jf-td--strong" style={{ paddingInlineStart: `${0.75 + depth * 1.25}rem` }}>
                            {term.name}
                            {term.description && <p className="jf-list__desc">{term.description}</p>}
                          </td>
                          <td><code className="jf-code">{term.slug}</code></td>
                          <td>{term.count}</td>
                          {canManageTerms && (
                            <td className="jf-td--actions">
                              <span className="jf-row" style={{ justifyContent: "flex-end" }}>
                                <button className="jf-btn jf-btn--ghost" onClick={() => startEdit(term)}>
                                  {t("taxonomies.edit")}
                                </button>
                                <button className="jf-btn jf-btn--danger" disabled={saving} onClick={() => removeTerm(term)}>
                                  {t("common.delete")}
                                </button>
                              </span>
                            </td>
                          )}
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
