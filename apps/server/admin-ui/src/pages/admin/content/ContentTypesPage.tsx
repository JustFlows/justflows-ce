// SPDX-License-Identifier: MIT
import "./content-types.css";
import ContentTypeSettingsFields, {
  type TypeSettings,
} from "../../../components/ContentTypeSettingsFields";
import CacheControlField from "../../../components/CacheControlField";
import { useEffect, useState } from "react";
import { initialJson } from "../../../ssr-data";
import { useSessionRole } from "@components/SessionProvider";
import { useT } from "../../../i18n/I18nProvider";

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "textarea" | "richtext" | "number" | "boolean" | "media" | "date" | "select";
  required: boolean;
  options?: string[];
}

interface ContentType {
  slug: string;
  label: string;
  description: string;
  builtin: boolean;
  fields: FieldDef[];
  settings?: TypeSettings;
  cacheControl: string | null;
  cacheControlEditable: boolean;
}

const FIELD_TYPES = [
  "text",
  "textarea",
  "richtext",
  "number",
  "boolean",
  "media",
  "date",
  "select",
] as const;

function emptyField(label: string): FieldDef {
  return { key: `field_${Date.now()}`, label, type: "text", required: false };
}

export default function ContentTypesPage() {
  const { t } = useT();
  /** The server independently restricts mutations to administrators. */
  const canManage = useSessionRole() === "administrator";
  const prefetched = initialJson<{ types?: ContentType[] }>("/api/content-types");
  const [types, setTypes] = useState<ContentType[]>(prefetched?.types ?? []);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<ContentType | null>(null);
  const [activeField, setActiveField] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newType, setNewType] = useState<{
    slug: string;
    label: string;
    description: string;
    cacheControl: string | null;
  }>({
    slug: "",
    label: "",
    description: "",
    cacheControl: null,
  });
  const [loading, setLoading] = useState(!prefetched);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/content-types");
    const data = (await res.json()) as { types?: ContentType[]; error?: string };
    if (!res.ok) throw new Error(data.error ?? t("contentTypes.loadFailed"));
    setTypes(data.types ?? []);
  }

  useEffect(() => {
    load()
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const dirty =
      draft &&
      JSON.stringify(draft) !== JSON.stringify(types.find((item) => item.slug === draft.slug));
    if (!dirty) return;
    function warnOnUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnOnUnload);
    return () => window.removeEventListener("beforeunload", warnOnUnload);
  }, [draft, types]);

  function updateLocal(_slug: string, next: ContentType) {
    setDraft(next);
    setSaved(false);
  }

  async function persist(type: ContentType) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/content-types/${encodeURIComponent(type.slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: type.label,
          description: type.description,
          fields: type.fields,
          settings: type.settings,
          ...(type.cacheControlEditable ? { cacheControl: type.cacheControl } : {}),
        }),
      });
      const data = (await res.json()) as { type?: ContentType; error?: string };
      if (!res.ok) throw new Error(data.error ?? t("contentTypes.saveFailed"));
      if (data.type) {
        setTypes((prev) => prev.map((item) => (item.slug === type.slug ? data.type! : item)));
        setDraft(data.type);
        setSaved(true);
        window.dispatchEvent(new Event("jf-content-types-changed"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveNew() {
    if (!newType.slug || !newType.label) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/content-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newType),
      });
      const data = (await res.json()) as { type?: ContentType; error?: string };
      if (!res.ok) throw new Error(data.error ?? t("contentTypes.createFailed"));
      if (data.type) {
        setTypes((prev) => [...prev, data.type!]);
        setDraft(data.type);
        setEditing(data.type.slug);
        setActiveField(null);
        setSaved(true);
        window.dispatchEvent(new Event("jf-content-types-changed"));
      }
      setCreating(false);
      setNewType({ slug: "", label: "", description: "", cacheControl: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function removeType(type: ContentType) {
    if (type.builtin) return;
    if (!confirm(t("contentTypes.deleteConfirm", { label: type.label }))) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/content-types/${encodeURIComponent(type.slug)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? t("contentTypes.deleteFailed"));
      setTypes((prev) => prev.filter((t) => t.slug !== type.slug));
      window.dispatchEvent(new Event("jf-content-types-changed"));
      if (editing === type.slug) setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="jf-page" aria-busy="true">
        <p>{t("contentTypes.loading")}</p>
      </div>
    );
  }

  const type = draft;
  const dirty =
    !!type &&
    JSON.stringify(type) !== JSON.stringify(types.find((item) => item.slug === type.slug));

  function leaveEditor() {
    if (dirty && !confirm(t("contentTypes.discardConfirm"))) return;
    setDraft(null);
    setEditing(null);
    setActiveField(null);
    setError(null);
  }

  function changeField(index: number, patch: Partial<FieldDef>) {
    if (!type) return;
    updateLocal(type.slug, {
      ...type,
      fields: type.fields.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    });
  }

  function moveField(index: number, direction: number) {
    if (!type) return;
    const fields = [...type.fields];
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    [fields[index], fields[target]] = [fields[target]!, fields[index]!];
    updateLocal(type.slug, { ...type, fields });
    setActiveField(null);
  }

  return (
    <div className="jf-page jf-content-types">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          {type && (
            <button className="jf-btn jf-btn--ghost" disabled={saving} onClick={leaveEditor}>
              ← {t("contentTypes.heading")}
            </button>
          )}
          <h1>{type ? type.label : t("contentTypes.heading")}</h1>
          {type ? (
            <code className="jf-code">{type.slug}</code>
          ) : (
            <p>{t("contentTypes.subtitle")}</p>
          )}
        </div>
        <div className="jf-pagehead__actions">
          {type && canManage ? (
            <button
              className="jf-btn jf-btn--primary"
              disabled={saving || !dirty}
              onClick={() => void persist(type)}
            >
              {saving
                ? t("common.saving")
                : saved && !dirty
                  ? t("contentTypes.saved")
                  : t("contentTypes.saveChanges")}
            </button>
          ) : (
            canManage && (
              <button className="jf-btn jf-btn--primary" onClick={() => setCreating(true)}>
                {t("contentTypes.newType")}
              </button>
            )
          )}
        </div>
      </header>
      {error && (
        <div className="jf-alert jf-alert--error" role="alert">
          {error}
        </div>
      )}
      {saved && type && !dirty && (
        <p role="status" className="jf-field__hint">
          {t("contentTypes.saved")}
        </p>
      )}
      {canManage && creating && (
        <div className="jf-card jf-card--active">
          <div className="jf-card__head">
            <h2 className="jf-card__title">{t("contentTypes.newTypeHeading")}</h2>
          </div>
          <div className="jf-card__body jf-stack">
            <div className="jf-grid jf-grid--2">
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jf-ct-slug">
                  {t("contentTypes.slugLabel")}
                </label>
                <input
                  id="jf-ct-slug"
                  className="jf-input"
                  placeholder="product"
                  value={newType.slug}
                  onChange={(e) =>
                    setNewType({
                      ...newType,
                      slug: e.target.value.toLowerCase().replace(/\s+/g, "-"),
                    })
                  }
                />
                <span className="jf-field__hint">{t("contentTypes.slugHint")}</span>
              </div>
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jf-ct-label">
                  {t("contentTypes.labelLabel")}
                </label>
                <input
                  id="jf-ct-label"
                  className="jf-input"
                  placeholder={t("ui.contentTypesPage.products")}
                  value={newType.label}
                  onChange={(e) => setNewType({ ...newType, label: e.target.value })}
                />
                <span className="jf-field__hint">{t("contentTypes.labelHint")}</span>
              </div>
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-ct-desc">
                {t("contentTypes.descriptionLabel")}
              </label>
              <input
                id="jf-ct-desc"
                className="jf-input"
                placeholder={t("contentTypes.optionalPlaceholder")}
                value={newType.description}
                onChange={(e) => setNewType({ ...newType, description: e.target.value })}
              />
            </div>
            <CacheControlField
              id="jf-ct-new-cache"
              value={newType.cacheControl}
              disabled={saving}
              onChange={(cacheControl) => setNewType({ ...newType, cacheControl })}
            />
            <div className="jf-row">
              <button
                className="jf-btn jf-btn--primary"
                disabled={saving || !newType.slug.trim() || !newType.label.trim()}
                onClick={() => void saveNew()}
              >
                {t("common.save")}
              </button>
              <button
                className="jf-btn jf-btn--ghost"
                disabled={saving}
                onClick={() => setCreating(false)}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {!type ? (
        <div className="jf-card jf-ct-overview">
          <table className="jf-ct-table">
            <caption className="jf-sr-only">{t("contentTypes.heading")}</caption>
            <thead>
              <tr>
                {["labelLabel", "slugLabel", "source", "customFields", "actions"].map((key) => (
                  <th key={key} scope="col">
                    {t(`contentTypes.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {types.map((item) => (
                <tr key={item.slug}>
                  <td>
                    <strong>{item.settings?.pluralLabel || item.label}</strong>
                    {item.description && <p className="jf-list__desc">{item.description}</p>}
                  </td>
                  <td>
                    <code className="jf-code">{item.slug}</code>
                  </td>
                  <td>
                    <span className="jf-badge">
                      {t(item.builtin ? "contentTypes.builtinBadge" : "contentTypes.customBadge")}
                    </span>
                  </td>
                  <td>{item.fields.length}</td>
                  <td>
                    <div className="jf-row">
                      <button
                        className="jf-btn jf-btn--ghost"
                        disabled={saving}
                        onClick={() => {
                          setDraft(structuredClone(item));
                          setEditing(item.slug);
                          setActiveField(null);
                          setCreating(false);
                          setSaved(false);
                          setError(null);
                        }}
                      >
                        {t("contentTypes.editFields")}
                      </button>
                      {canManage && !item.builtin && (
                        <button
                          className="jf-btn jf-btn--danger"
                          disabled={saving}
                          onClick={() => void removeType(item)}
                        >
                          {t("common.delete")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {types.length === 0 && <div className="jf-card__body">{t("contentTypes.empty")}</div>}
        </div>
      ) : (
        <div className="jf-ct-layout">
          <section className="jf-card jf-ct-settings" aria-labelledby="ct-settings">
            <div className="jf-card__head">
              <h2 id="ct-settings" className="jf-card__title">
                {t("contentTypes.settings")}
              </h2>
            </div>
            <fieldset
              className="jf-card__body jf-stack jf-ct-fieldset"
              disabled={!canManage || saving}
            >
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="ct-label">
                  {t("contentTypes.labelLabel")}
                </label>
                <input
                  id="ct-label"
                  className="jf-input"
                  maxLength={255}
                  value={type.label}
                  onChange={(e) => updateLocal(type.slug, { ...type, label: e.target.value })}
                />
                <span className="jf-field__hint">{t("contentTypes.labelHint")}</span>
              </div>
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="ct-description">
                  {t("contentTypes.descriptionLabel")}
                </label>
                <textarea
                  id="ct-description"
                  className="jf-input"
                  rows={4}
                  maxLength={2000}
                  value={type.description}
                  onChange={(e) => updateLocal(type.slug, { ...type, description: e.target.value })}
                />
              </div>
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="ct-slug">
                  {t("contentTypes.slugLabel")}
                </label>
                <input id="ct-slug" className="jf-input" value={type.slug} readOnly />
                <span className="jf-field__hint">{t("contentTypes.slugImmutable")}</span>
              </div>
              <ContentTypeSettingsFields
                slug={type.slug}
                settings={type.settings}
                onChange={(settings) => updateLocal(type.slug, { ...type, settings })}
              />
              {type.cacheControlEditable && (
                <CacheControlField
                  id={`jf-ct-cache-${type.slug}`}
                  value={type.cacheControl ?? null}
                  disabled={!canManage || saving}
                  onChange={(cacheControl) => updateLocal(type.slug, { ...type, cacheControl })}
                />
              )}
            </fieldset>
          </section>
          <section className="jf-card" aria-labelledby="ct-fields">
            <div className="jf-card__head">
              <div>
                <h2 id="ct-fields" className="jf-card__title">
                  {t("contentTypes.fieldsHeading", { count: type.fields.length })}
                </h2>
                <p className="jf-list__desc">{t("contentTypes.fieldsHint")}</p>
              </div>
              {canManage && (
                <button
                  className="jf-btn jf-btn--ghost"
                  disabled={saving || type.fields.length >= 50}
                  onClick={() => {
                    updateLocal(type.slug, {
                      ...type,
                      fields: [...type.fields, emptyField(t("ui.contentTypesPage.newField"))],
                    });
                    setActiveField(type.fields.length);
                  }}
                >
                  {t("contentTypes.addField")}
                </button>
              )}
            </div>
            <h3 className="jf-ct-section-title">{t("contentTypes.systemFields")}</h3>
            <div className="jf-ct-system-fields">
              {["id", "title", "slug", "status", "createdAt", "updatedAt", "publishedAt"].map(
                (key) => (
                  <div key={key} className="jf-ct-system-field">
                    <span>{t(`contentTypes.system.${key}`)}</span>
                    <code className="jf-code">{key}</code>
                    <span className="jf-badge">{t("contentTypes.systemBadge")}</span>
                  </div>
                ),
              )}
            </div>
            <h3 className="jf-ct-section-title">{t("contentTypes.customFields")}</h3>
            {type.fields.length === 0 && (
              <p className="jf-card__body jf-field__hint">{t("contentTypes.noFieldsYet")}</p>
            )}
            {type.fields.map((field, i) => (
              <div key={i} className="jf-ct-field">
                <div className="jf-ct-field-summary">
                  <div>
                    <strong>{field.label}</strong> <code className="jf-code">{field.key}</code>
                    <p className="jf-list__desc">
                      {t(`contentTypes.kinds.${field.type}`)}{" "}
                      {field.required && (
                        <span className="jf-badge">{t("contentTypes.requiredLabel")}</span>
                      )}
                    </p>
                  </div>
                  <div className="jf-row">
                    {canManage && (
                      <>
                        <button
                          className="jf-btn jf-btn--ghost"
                          aria-label={t("contentTypes.moveUp", { label: field.label })}
                          disabled={saving || i === 0}
                          onClick={() => moveField(i, -1)}
                        >
                          ↑
                        </button>
                        <button
                          className="jf-btn jf-btn--ghost"
                          aria-label={t("contentTypes.moveDown", { label: field.label })}
                          disabled={saving || i === type.fields.length - 1}
                          onClick={() => moveField(i, 1)}
                        >
                          ↓
                        </button>
                      </>
                    )}
                    <button
                      className="jf-btn jf-btn--ghost"
                      aria-expanded={activeField === i}
                      aria-controls={`ct-field-${i}`}
                      onClick={() => setActiveField(activeField === i ? null : i)}
                    >
                      {t(
                        activeField === i ? "contentTypes.closeFields" : "contentTypes.editFields",
                      )}
                    </button>
                    {canManage && (
                      <button
                        className="jf-btn jf-btn--danger"
                        disabled={saving}
                        aria-label={t("contentTypes.removeFieldAria", { label: field.label })}
                        onClick={() => {
                          if (
                            !confirm(t("contentTypes.removeFieldConfirm", { label: field.label }))
                          )
                            return;
                          updateLocal(type.slug, {
                            ...type,
                            fields: type.fields.filter((_, j) => j !== i),
                          });
                          setActiveField(null);
                        }}
                      >
                        {t("common.delete")}
                      </button>
                    )}
                  </div>
                </div>
                {activeField === i && (
                  <fieldset
                    id={`ct-field-${i}`}
                    className="jf-ct-fieldset jf-ct-field-editor jf-stack"
                    disabled={!canManage || saving}
                  >
                    <div className="jf-grid jf-grid--2">
                      <label className="jf-field">
                        {t("contentTypes.fieldLabelAria")}
                        <input
                          className="jf-input"
                          value={field.label}
                          maxLength={255}
                          onChange={(e) => changeField(i, { label: e.target.value })}
                        />
                      </label>
                      <label className="jf-field">
                        {t("contentTypes.fieldKeyAria")}
                        <input
                          className="jf-input"
                          value={field.key}
                          onChange={(e) => changeField(i, { key: e.target.value })}
                        />
                      </label>
                    </div>
                    <label className="jf-field">
                      {t("contentTypes.fieldTypeAria")}
                      <select
                        className="jf-input"
                        value={field.type}
                        onChange={(e) =>
                          changeField(i, { type: e.target.value as FieldDef["type"] })
                        }
                      >
                        {FIELD_TYPES.map((kind) => (
                          <option key={kind} value={kind}>
                            {t(`contentTypes.kinds.${kind}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="jf-row">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => changeField(i, { required: e.target.checked })}
                      />
                      {t("contentTypes.requiredLabel")}
                    </label>
                    {field.type === "select" && (
                      <label className="jf-field">
                        {t("contentTypes.selectOptionsAria")}
                        <input
                          className="jf-input"
                          aria-label={t("contentTypes.selectOptionsAria")}
                          placeholder={t("ui.contentTypesPage.smallMediumLarge")}
                          value={(field.options ?? []).join(",")}
                          onChange={(e) => changeField(i, { options: e.target.value.split(",") })}
                        />
                        <span className="jf-field__hint">{t("contentTypes.optionsHint")}</span>
                      </label>
                    )}
                  </fieldset>
                )}
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
