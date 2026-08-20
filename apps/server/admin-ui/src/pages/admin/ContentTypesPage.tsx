import { useState } from "react";

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "textarea" | "richtext" | "number" | "boolean" | "media" | "date" | "select";
  required: boolean;
}

interface ContentType {
  slug: string;
  label: string;
  description: string;
  fields: FieldDef[];
}

const FIELD_TYPES = ["text", "textarea", "richtext", "number", "boolean", "media", "date", "select"] as const;

export default function ContentTypesPage() {
  const [types, setTypes] = useState<ContentType[]>([
    { slug: "post", label: "Post", description: "Blog post", fields: [] },
    { slug: "page", label: "Page", description: "Static page", fields: [] },
  ]);
  const [editing, setEditing] = useState<ContentType | null>(null);
  const [creating, setCreating] = useState(false);
  const [newType, setNewType] = useState<Partial<ContentType>>({});

  function apply(updated: ContentType) {
    setEditing(updated);
    setTypes((prev) => prev.map((t) => (t.slug === updated.slug ? updated : t)));
  }

  function addField(type: ContentType) {
    apply({
      ...type,
      fields: [...type.fields, { key: `field_${Date.now()}`, label: "New field", type: "text", required: false }],
    });
  }

  function saveNew() {
    if (!newType.slug || !newType.label) return;
    setTypes((prev) => [...prev, {
      slug: newType.slug!,
      label: newType.label!,
      description: newType.description ?? "",
      fields: [],
    }]);
    setCreating(false);
    setNewType({});
  }

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>Content Types</h1>
          <p>Define custom content types and their fields</p>
        </div>
        <div className="jf-pagehead__actions">
          <button className="jf-btn jf-btn--primary" onClick={() => setCreating(true)}>+ New type</button>
        </div>
      </header>

      {creating && (
        <div className="jf-card jf-card--active">
          <div className="jf-card__head">
            <h2 className="jf-card__title">New content type</h2>
          </div>
          <div className="jf-card__body jf-stack">
            <div className="jf-grid jf-grid--2">
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jf-ct-slug">Slug</label>
                <input
                  id="jf-ct-slug"
                  className="jf-input"
                  placeholder="product"
                  value={newType.slug ?? ""}
                  onChange={(e) => setNewType({ ...newType, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })}
                />
                <span className="jf-field__hint">Lowercase, used in URLs and the API.</span>
              </div>
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jf-ct-label">Label</label>
                <input
                  id="jf-ct-label"
                  className="jf-input"
                  placeholder="Products"
                  value={newType.label ?? ""}
                  onChange={(e) => setNewType({ ...newType, label: e.target.value })}
                />
                <span className="jf-field__hint">Shown throughout the admin.</span>
              </div>
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-ct-desc">Description</label>
              <input
                id="jf-ct-desc"
                className="jf-input"
                placeholder="Optional"
                value={newType.description ?? ""}
                onChange={(e) => setNewType({ ...newType, description: e.target.value })}
              />
            </div>
            <div className="jf-row">
              <button className="jf-btn jf-btn--primary" onClick={saveNew}>Save</button>
              <button className="jf-btn jf-btn--ghost" onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="jf-stack">
        {types.map((type) => {
          const isBuiltin = type.slug === "post" || type.slug === "page";
          const isEditing = editing?.slug === type.slug;
          return (
            <div key={type.slug} className="jf-card">
              <div className="jf-card__head">
                <div style={{ minWidth: 0 }}>
                  <div className="jf-row" style={{ gap: "0.5rem" }}>
                    <strong>{type.label}</strong>
                    <code className="jf-code">{type.slug}</code>
                    {isBuiltin && <span className="jf-badge">built-in</span>}
                  </div>
                  {type.description && <p className="jf-list__desc">{type.description}</p>}
                </div>
                <button
                  className="jf-btn jf-btn--ghost"
                  onClick={() => setEditing(isEditing ? null : type)}
                >
                  {isEditing ? "Close" : "Edit fields"}
                </button>
              </div>

              {isEditing && (
                <div className="jf-card__body jf-stack">
                  <h3 className="jf-card__title">Fields ({type.fields.length})</h3>

                  {type.fields.length === 0 && (
                    <p className="jf-prose">No fields yet — add one below.</p>
                  )}

                  {type.fields.map((field, i) => (
                    <div
                      key={i}
                      className="jf-grid"
                      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr)) auto", alignItems: "center" }}
                    >
                      <input
                        className="jf-input"
                        placeholder="key"
                        value={field.key}
                        onChange={(e) => apply({
                          ...type,
                          fields: type.fields.map((f, j) => (j === i ? { ...f, key: e.target.value } : f)),
                        })}
                      />
                      <input
                        className="jf-input"
                        placeholder="Label"
                        value={field.label}
                        onChange={(e) => apply({
                          ...type,
                          fields: type.fields.map((f, j) => (j === i ? { ...f, label: e.target.value } : f)),
                        })}
                      />
                      <select
                        className="jf-input"
                        value={field.type}
                        onChange={(e) => apply({
                          ...type,
                          fields: type.fields.map((f, j) =>
                            (j === i ? { ...f, type: e.target.value as FieldDef["type"] } : f)),
                        })}
                      >
                        {FIELD_TYPES.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
                      </select>
                      <button
                        className="jf-btn jf-btn--danger"
                        aria-label={`Remove field ${field.label}`}
                        onClick={() => apply({ ...type, fields: type.fields.filter((_, j) => j !== i) })}
                      >
                        ✕
                      </button>
                    </div>
                  ))}

                  <div className="jf-row">
                    <button className="jf-btn jf-btn--ghost" onClick={() => addField(type)}>
                      + Add field
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
