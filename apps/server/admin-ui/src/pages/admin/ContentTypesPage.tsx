import { useEffect, useState } from "react";
import { initialJson } from "../../ssr-data";

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

function emptyField(): FieldDef {
  return { key: `field_${Date.now()}`, label: "New field", type: "text", required: false };
}

export default function ContentTypesPage() {
  const prefetched = initialJson<{ types?: ContentType[] }>("/api/content-types");
  const [types, setTypes] = useState<ContentType[]>(prefetched?.types ?? []);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newType, setNewType] = useState<{ slug: string; label: string; description: string }>({
    slug: "",
    label: "",
    description: "",
  });
  const [loading, setLoading] = useState(!prefetched);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/content-types");
    const data = (await res.json()) as { types?: ContentType[]; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to load content types");
    setTypes(data.types ?? []);
  }

  useEffect(() => {
    load()
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function updateLocal(slug: string, next: ContentType) {
    setTypes((prev) => prev.map((t) => (t.slug === slug ? next : t)));
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
        }),
      });
      const data = (await res.json()) as { type?: ContentType; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      if (data.type) updateLocal(type.slug, data.type);
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
      if (!res.ok) throw new Error(data.error ?? "Failed to create");
      if (data.type) setTypes((prev) => [...prev, data.type!]);
      setCreating(false);
      setNewType({ slug: "", label: "", description: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function removeType(type: ContentType) {
    if (type.builtin) return;
    if (
      !confirm(
        `Delete content type “${type.label}”? Existing entries of this type must be removed first.`,
      )
    )
      return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/content-types/${encodeURIComponent(type.slug)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to delete");
      setTypes((prev) => prev.filter((t) => t.slug !== type.slug));
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
        <p>Loading content types…</p>
      </div>
    );
  }

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>Content Types</h1>
          <p>Define custom content types and their fields. Posts and pages stay built-in.</p>
        </div>
        <div className="jf-pagehead__actions">
          <button className="jf-btn jf-btn--primary" onClick={() => setCreating(true)}>
            + New type
          </button>
        </div>
      </header>

      {error && (
        <div className="jf-alert jf-alert--error" role="alert">
          {error}
        </div>
      )}

      {creating && (
        <div className="jf-card jf-card--active">
          <div className="jf-card__head">
            <h2 className="jf-card__title">New content type</h2>
          </div>
          <div className="jf-card__body jf-stack">
            <div className="jf-grid jf-grid--2">
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jf-ct-slug">
                  Slug
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
                <span className="jf-field__hint">Lowercase, used in URLs and the API.</span>
              </div>
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jf-ct-label">
                  Label
                </label>
                <input
                  id="jf-ct-label"
                  className="jf-input"
                  placeholder="Products"
                  value={newType.label}
                  onChange={(e) => setNewType({ ...newType, label: e.target.value })}
                />
                <span className="jf-field__hint">Shown throughout the admin.</span>
              </div>
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-ct-desc">
                Description
              </label>
              <input
                id="jf-ct-desc"
                className="jf-input"
                placeholder="Optional"
                value={newType.description}
                onChange={(e) => setNewType({ ...newType, description: e.target.value })}
              />
            </div>
            <div className="jf-row">
              <button
                className="jf-btn jf-btn--primary"
                disabled={saving}
                onClick={() => void saveNew()}
              >
                Save
              </button>
              <button className="jf-btn jf-btn--ghost" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="jf-stack">
        {types.map((type) => {
          const isEditing = editing === type.slug;
          return (
            <div key={type.slug} className="jf-card">
              <div className="jf-card__head">
                <div style={{ minWidth: 0 }}>
                  <div className="jf-row" style={{ gap: "0.5rem" }}>
                    <strong>{type.label}</strong>
                    <code className="jf-code">{type.slug}</code>
                    {type.builtin && <span className="jf-badge">built-in</span>}
                  </div>
                  {type.description && <p className="jf-list__desc">{type.description}</p>}
                </div>
                <div className="jf-row">
                  <button
                    className="jf-btn jf-btn--ghost"
                    onClick={() => setEditing(isEditing ? null : type.slug)}
                  >
                    {isEditing ? "Close" : "Edit fields"}
                  </button>
                  {!type.builtin && (
                    <button className="jf-btn jf-btn--danger" onClick={() => void removeType(type)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>

              {isEditing && (
                <div className="jf-card__body jf-stack">
                  <h3 className="jf-card__title">Fields ({type.fields.length})</h3>

                  {type.fields.length === 0 && (
                    <p className="jf-prose">No fields yet — add one below.</p>
                  )}

                  {type.fields.map((field, i) => (
                    <div
                      key={`${type.slug}-${i}`}
                      className="jf-grid"
                      style={{
                        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr)) auto",
                        alignItems: "center",
                      }}
                    >
                      <input
                        className="jf-input"
                        aria-label="Field key"
                        placeholder="key"
                        value={field.key}
                        onChange={(e) =>
                          updateLocal(type.slug, {
                            ...type,
                            fields: type.fields.map((f, j) =>
                              j === i ? { ...f, key: e.target.value } : f,
                            ),
                          })
                        }
                      />
                      <input
                        className="jf-input"
                        aria-label="Field label"
                        placeholder="Label"
                        value={field.label}
                        onChange={(e) =>
                          updateLocal(type.slug, {
                            ...type,
                            fields: type.fields.map((f, j) =>
                              j === i ? { ...f, label: e.target.value } : f,
                            ),
                          })
                        }
                      />
                      <select
                        className="jf-input"
                        aria-label="Field type"
                        value={field.type}
                        onChange={(e) =>
                          updateLocal(type.slug, {
                            ...type,
                            fields: type.fields.map((f, j) =>
                              j === i ? { ...f, type: e.target.value as FieldDef["type"] } : f,
                            ),
                          })
                        }
                      >
                        {FIELD_TYPES.map((ft) => (
                          <option key={ft} value={ft}>
                            {ft}
                          </option>
                        ))}
                      </select>
                      <label className="jf-row" style={{ gap: "0.35rem" }}>
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) =>
                            updateLocal(type.slug, {
                              ...type,
                              fields: type.fields.map((f, j) =>
                                j === i ? { ...f, required: e.target.checked } : f,
                              ),
                            })
                          }
                        />
                        Required
                      </label>
                      {field.type === "select" && (
                        <input
                          className="jf-input"
                          aria-label="Select options"
                          placeholder="small, medium, large"
                          value={(field.options ?? []).join(", ")}
                          onChange={(e) =>
                            updateLocal(type.slug, {
                              ...type,
                              fields: type.fields.map((f, j) =>
                                j === i
                                  ? {
                                      ...f,
                                      options: e.target.value
                                        .split(",")
                                        .map((s) => s.trim())
                                        .filter(Boolean),
                                    }
                                  : f,
                              ),
                            })
                          }
                        />
                      )}
                      <button
                        className="jf-btn jf-btn--danger"
                        aria-label={`Remove field ${field.label}`}
                        onClick={() =>
                          updateLocal(type.slug, {
                            ...type,
                            fields: type.fields.filter((_, j) => j !== i),
                          })
                        }
                      >
                        ✕
                      </button>
                    </div>
                  ))}

                  <div className="jf-row">
                    <button
                      className="jf-btn jf-btn--ghost"
                      onClick={() =>
                        updateLocal(type.slug, { ...type, fields: [...type.fields, emptyField()] })
                      }
                    >
                      + Add field
                    </button>
                    <button
                      className="jf-btn jf-btn--primary"
                      disabled={saving}
                      onClick={() => void persist(type)}
                    >
                      {saving ? "Saving…" : "Save fields"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
