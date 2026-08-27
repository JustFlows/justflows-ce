import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSessionRole } from "@components/SessionProvider";

type FieldType = "text" | "email" | "textarea" | "tel" | "select" | "checkbox";

interface FormField {
  id: string;
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string;
}

interface FormDefinition {
  name: string;
  title: string;
  submitLabel: string;
  successMessage: string;
  fields: FormField[];
}

interface FormRecord {
  id: string;
  data: FormDefinition;
}

interface Submission {
  id: string;
  data: {
    formId: string;
    formName: string;
    values: Record<string, string>;
    createdAt: string;
  };
}

const FIELD_TYPES: Array<{ value: FieldType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "textarea", label: "Long text" },
  { value: "tel", label: "Phone" },
  { value: "select", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" },
];

function blankField(): FormField {
  return { id: crypto.randomUUID(), name: "field", label: "New field", type: "text", required: false };
}

function blankForm(): FormDefinition {
  return {
    name: "New form",
    title: "",
    submitLabel: "Send",
    successMessage: "Thanks, we received your message.",
    fields: [
      { id: crypto.randomUUID(), name: "name", label: "Name", type: "text", required: true },
      { id: crypto.randomUUID(), name: "email", label: "Email", type: "email", required: true },
      { id: crypto.randomUUID(), name: "message", label: "Message", type: "textarea", required: true },
    ],
  };
}

export default function FormsPage() {
  // Reading forms and submissions is administrator/editor; creating, saving,
  // and deleting either are administrator-only.
  const canManage = useSessionRole() === "administrator";
  const [enabled, setEnabled] = useState(true);
  const [forms, setForms] = useState<FormRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FormDefinition>(blankForm());
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [tab, setTab] = useState<"build" | "inbox">("build");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const selected = forms.find((form) => form.id === selectedId) ?? null;

  async function loadForms(preferId?: string) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/forms");
      const body = await res.json() as { enabled?: boolean; forms?: FormRecord[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not load forms");
      setEnabled(body.enabled !== false);
      const next = body.forms ?? [];
      setForms(next);
      const nextId = preferId && next.some((form) => form.id === preferId)
        ? preferId
        : next[0]?.id ?? null;
      setSelectedId(nextId);
      const current = next.find((form) => form.id === nextId);
      if (current) setDraft(current.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadForms();
  }, []);

  useEffect(() => {
    if (!selectedId || tab !== "inbox") return;
    fetch(`/api/forms/${selectedId}/submissions`)
      .then((r) => r.json())
      .then((body: { submissions?: Submission[] }) => setSubmissions(body.submissions ?? []))
      .catch(() => setSubmissions([]));
  }, [selectedId, tab]);

  function selectForm(id: string) {
    const form = forms.find((item) => item.id === id);
    setSelectedId(id);
    setSaved(false);
    if (form) setDraft(form.data);
  }

  async function save() {
    if (!selectedId) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch(`/api/forms/${selectedId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json() as { form?: FormRecord; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      setSaved(true);
      await loadForms(selectedId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function createForm() {
    setError("");
    const res = await fetch("/api/forms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(blankForm()),
    });
    const body = await res.json() as { form?: FormRecord; error?: string };
    if (!res.ok) {
      setError(body.error ?? "Could not create form");
      return;
    }
    await loadForms(body.form?.id);
    setTab("build");
  }

  async function removeForm() {
    if (!selectedId || !window.confirm("Delete this form? Existing submissions are kept.")) return;
    await fetch(`/api/forms/${selectedId}`, { method: "DELETE" });
    await loadForms();
  }

  async function removeSubmission(id: string) {
    if (!selectedId) return;
    await fetch(`/api/forms/${selectedId}/submissions/${id}`, { method: "DELETE" });
    setSubmissions((current) => current.filter((row) => row.id !== id));
  }

  function updateField(index: number, patch: Partial<FormField>) {
    setDraft((current) => ({
      ...current,
      fields: current.fields.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    }));
  }

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>Forms</h1>
          <p>Build a form, drop it on a page with the Form block, then read submissions here.</p>
        </div>
        {canManage && (
          <button className="jf-btn jf-btn--primary" type="button" onClick={() => void createForm()}>
            New form
          </button>
        )}
      </header>

      {error && <div className="jf-alert jf-alert--error" role="alert">{error}</div>}

      {loading ? (
        <div className="jf-card"><div className="jf-card__body">Loading…</div></div>
      ) : !enabled ? (
        <div className="jf-card">
          <div className="jf-empty">
            <span className="jf-empty__title">Forms is not available</span>
            <p>Install Forms from the marketplace, or activate it under Plugins if it is deactivated.</p>
            <Link className="jf-btn jf-btn--primary" to="/admin/plugins">Open Plugins</Link>
          </div>
        </div>
      ) : (
        <div className="jf-grid jf-grid--2">
          <div className="jf-card">
            <div className="jf-card__head"><h2 className="jf-card__title">Your forms</h2></div>
            <div className="jf-card__body">
              {forms.length === 0 ? (
                <p className="jf-meta">No forms yet.</p>
              ) : (
                <ul className="jf-stack jf-stack--sm" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {forms.map((form) => (
                    <li key={form.id}>
                      <button
                        type="button"
                        className="jf-btn jf-btn--ghost"
                        style={{ width: "100%", justifyContent: "space-between" }}
                        onClick={() => selectForm(form.id)}
                        aria-pressed={form.id === selectedId}
                      >
                        <span>{form.data.name}</span>
                        <code className="jf-code">{form.id}</code>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">{selected ? selected.data.name : "Form"}</h2>
            </div>
            <div className="jf-card__body jf-stack">
              {!selected ? (
                <p className="jf-meta">Select or create a form.</p>
              ) : (
                <>
                  <div className="jf-tabs" role="tablist">
                    <button type="button" className="jf-tab" role="tab" aria-selected={tab === "build"} onClick={() => setTab("build")}>Builder</button>
                    <button type="button" className="jf-tab" role="tab" aria-selected={tab === "inbox"} onClick={() => setTab("inbox")}>Submissions</button>
                  </div>

                  {tab === "build" ? (
                    <>
                      {saved && <div className="jf-alert jf-alert--success">Saved. Add a Form block on a page and choose this form.</div>}
                      <label className="jf-stack jf-stack--sm"><span>Name</span>
                        <input className="jf-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                      </label>
                      <label className="jf-stack jf-stack--sm"><span>Heading on the page</span>
                        <input className="jf-input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                      </label>
                      <label className="jf-stack jf-stack--sm"><span>Submit button</span>
                        <input className="jf-input" value={draft.submitLabel} onChange={(e) => setDraft({ ...draft, submitLabel: e.target.value })} />
                      </label>
                      <label className="jf-stack jf-stack--sm"><span>Thanks message</span>
                        <input className="jf-input" value={draft.successMessage} onChange={(e) => setDraft({ ...draft, successMessage: e.target.value })} />
                      </label>

                      <div className="jf-stack">
                        {draft.fields.map((field, index) => (
                          <div key={field.id} className="jf-card" style={{ boxShadow: "none" }}>
                            <div className="jf-card__body jf-stack jf-stack--sm">
                              <label className="jf-stack jf-stack--sm"><span>Label</span>
                                <input className="jf-input" value={field.label} onChange={(e) => updateField(index, { label: e.target.value })} />
                              </label>
                              <label className="jf-stack jf-stack--sm"><span>Field name</span>
                                <input className="jf-input" value={field.name} onChange={(e) => updateField(index, { name: e.target.value })} />
                              </label>
                              <label className="jf-stack jf-stack--sm"><span>Type</span>
                                <select className="jf-input" value={field.type} onChange={(e) => updateField(index, { type: e.target.value as FieldType })}>
                                  {FIELD_TYPES.map((type) => (
                                    <option key={type.value} value={type.value}>{type.label}</option>
                                  ))}
                                </select>
                              </label>
                              {field.type === "select" && (
                                <label className="jf-stack jf-stack--sm"><span>Options (comma-separated)</span>
                                  <input className="jf-input" value={field.options ?? ""} onChange={(e) => updateField(index, { options: e.target.value })} />
                                </label>
                              )}
                              <label className="jf-row" style={{ gap: "0.5rem" }}>
                                <input type="checkbox" checked={field.required} onChange={(e) => updateField(index, { required: e.target.checked })} />
                                Required
                              </label>
                              <button type="button" className="jf-btn jf-btn--ghost" onClick={() => setDraft({ ...draft, fields: draft.fields.filter((_, i) => i !== index) })}>
                                Remove field
                              </button>
                            </div>
                          </div>
                        ))}
                        <button type="button" className="jf-btn jf-btn--ghost" onClick={() => setDraft({ ...draft, fields: [...draft.fields, blankField()] })}>
                          Add field
                        </button>
                      </div>

                      {canManage && (
                        <div className="jf-row">
                          <button className="jf-btn jf-btn--primary" type="button" disabled={saving} onClick={() => void save()}>
                            {saving ? "Saving…" : "Save form"}
                          </button>
                          <button className="jf-btn jf-btn--danger" type="button" onClick={() => void removeForm()}>Delete</button>
                        </div>
                      )}
                    </>
                  ) : submissions.length === 0 ? (
                    <p className="jf-meta">No submissions yet. Publish a page with this form, then send a test message.</p>
                  ) : (
                    <div className="jf-stack">
                      {submissions.map((row) => (
                        <div key={row.id} className="jf-card" style={{ boxShadow: "none" }}>
                          <div className="jf-card__body">
                            <p className="jf-meta">{new Date(row.data.createdAt).toLocaleString()}</p>
                            <dl className="jf-stack jf-stack--sm" style={{ margin: "0.75rem 0" }}>
                              {Object.entries(row.data.values).map(([key, value]) => (
                                <div key={key}>
                                  <dt className="jf-meta">{key}</dt>
                                  <dd style={{ margin: 0 }}>{value}</dd>
                                </div>
                              ))}
                            </dl>
                            {canManage && (
                              <button type="button" className="jf-btn jf-btn--ghost" onClick={() => void removeSubmission(row.id)}>Delete</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
