import { useEffect, useMemo, useState } from "react";
import { useCapability } from "../../components/SessionProvider";

type Variable = { key: string; label: string; description: string; example: string; required?: boolean };
type Template = { key: string; owner: string; label: string; description: string; purpose: string; recipient: string; disableSafe: boolean; variables: Variable[]; current: { locale: string; version: number; status: string; enabled: boolean; senderName: string; replyToPolicy: "global" | "none"; subject: string; preheader: string; html: string; text: string } };
type Design = { logoUrl: string; darkLogoUrl: string; accentColor: string; pageBackground: string; contentBackground: string; textColor: string; fontFamily: string; contentWidth: number; radius: number; alignment: "left" | "center"; companyName: string; address: string; supportContact: string; footerText: string };
type Language = { id: string; code: string; name: string; nativeName: string; isDefault: boolean; isActive: boolean; sortOrder: number };
type Payload = { locale: string; languages: Language[]; templates: Template[]; design: { design: Design; version: number; status: string } };
type Preview = { subject: string; preheader: string; html: string; text: string; fallback: boolean; errors: string[] };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error((body as { error?: string }).error ?? "Request failed");
  return body as T;
}

export default function EmailsPage() {
  const canManage = useCapability("email-templates:manage");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState<Template["current"] | null>(null);
  const [design, setDesign] = useState<Design | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [view, setView] = useState<"desktop" | "mobile" | "text">("desktop");
  const [panel, setPanel] = useState<"templates" | "design">("templates");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [testTo, setTestTo] = useState("");

  async function load(locale?: string) {
    const data = await json<Payload>(`/api/emails${locale ? `?locale=${encodeURIComponent(locale)}` : ""}`);
    setPayload(data);
    setDesign(data.design.design);
    const key = selected || data.templates[0]?.key || "";
    setSelected(key);
    setDraft(data.templates.find((item) => item.key === key)?.current ?? null);
  }

  async function changeLocale(locale: string) {
    setBusy(true);
    setMessage("");
    try {
      await load(locale);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load this translation");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load().catch((error: Error) => setMessage(error.message)); }, []);
  const definition = payload?.templates.find((item) => item.key === selected) ?? null;
  const filtered = useMemo(() => payload?.templates.filter((item) => `${item.label} ${item.description} ${item.owner} ${item.purpose}`.toLowerCase().includes(query.toLowerCase())) ?? [], [payload, query]);

  useEffect(() => {
    if (!definition) return;
    setDraft(definition.current);
  }, [selected, payload]);

  useEffect(() => {
    if (!definition || !draft || !design) return;
    const timer = window.setTimeout(() => {
      void json<Preview>(`/api/emails/${encodeURIComponent(definition.key)}/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale: draft.locale, values: Object.fromEntries(definition.variables.map((item) => [item.key, item.example])), mode: "draft", template: { subject: draft.subject, preheader: draft.preheader, html: draft.html, text: draft.text }, design }) }).then(setPreview).catch((error: Error) => setMessage(error.message));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [definition, draft?.locale, draft?.subject, draft?.preheader, draft?.html, draft?.text, design]);

  async function saveTemplate(publish: boolean) {
    if (!definition || !draft) return;
    setBusy(true); setMessage("");
    try {
      await json(`/api/emails/${encodeURIComponent(definition.key)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...draft, publish }) });
      setMessage(publish ? "Template published." : "Draft saved.");
      await load(draft.locale);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save"); } finally { setBusy(false); }
  }

  async function saveDesign(publish: boolean) {
    if (!design) return;
    setBusy(true); setMessage("");
    try { await json("/api/emails/design", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ design, publish }) }); setMessage(publish ? "Design published." : "Design draft saved."); await load(payload?.locale); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save"); } finally { setBusy(false); }
  }

  async function restore() {
    if (!definition || !draft || !confirm("Restore this template to its safe built-in default?")) return;
    await json(`/api/emails/${encodeURIComponent(definition.key)}/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale: draft.locale }) });
    setMessage("Default restored as a draft."); await load(draft.locale);
  }

  async function restoreDesign() {
    if (!confirm("Reset the global design to its built-in defaults? This replaces the current draft.")) return;
    setBusy(true); setMessage("");
    try {
      const result = await json<{ design: Design }>("/api/emails/design/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      setDesign(result.design);
      setMessage("Design defaults restored as a draft.");
      await load(payload?.locale);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not reset the design"); } finally { setBusy(false); }
  }

  async function sendTest() {
    if (!definition || !testTo) return;
    setBusy(true); setMessage("");
    try { await json(`/api/emails/${encodeURIComponent(definition.key)}/test`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: testTo, locale: draft?.locale }) }); setMessage(`Test sent to ${testTo}.`); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not send test"); } finally { setBusy(false); }
  }

  if (!payload || !draft || !design) return <div className="jf-page" aria-busy="true"><div className="jf-card"><div className="jf-card__body"><div className="jf-skeleton" style={{ height: 420 }} /></div></div></div>;
  return <div className="jf-page jf-email-page">
    <header className="jf-pagehead">
      <div className="jf-pagehead__text"><h1>System emails</h1><p>Brand, customize, localize, preview, and publish transactional email.</p></div>
      <div className="jf-pagehead__actions"><label className="jf-field jf-email-language"><span className="jf-field__label">Translation</span><select className="jf-input" value={payload.locale} onChange={(event) => void changeLocale(event.target.value)} disabled={busy}>{payload.languages.map((language) => <option key={language.id} value={language.code}>{language.nativeName} ({language.code}){language.isDefault ? " — default" : ""}</option>)}</select></label><span className={`jf-badge jf-badge--${payload.design.status === "published" ? "ok" : "info"}`}>Design {payload.design.status}</span><span className="jf-badge jf-badge--info">v{payload.design.version}</span></div>
    </header>
    <div className="jf-tabs" role="tablist" aria-label="Email settings">
      <button type="button" className="jf-tab" role="tab" aria-selected={panel === "templates"} onClick={() => setPanel("templates")}>Templates</button>
      <button type="button" className="jf-tab" role="tab" aria-selected={panel === "design"} onClick={() => setPanel("design")}>Global design</button>
    </div>
    {message && <div className={`jf-alert ${/could not|failed|invalid|error/i.test(message) ? "jf-alert--error" : "jf-alert--success"}`} role="status">{message}</div>}
    {!canManage && <div className="jf-alert">You can preview system emails, but the <code className="jf-code">email-templates:manage</code> capability is required to make changes.</div>}
    <div className="jf-alert jf-email-translation-note">Editing <strong>{payload.languages.find((language) => language.code === payload.locale)?.nativeName ?? payload.locale}</strong>. Drafts and published versions are stored independently for each configured language.</div>
    {panel === "design" ? <div className="jf-email-design"><section className="jf-card"><div className="jf-card__head"><div><h2 className="jf-card__title">Brand and layout</h2><p className="jf-field__hint">Shared presentation for every system email.</p></div></div><div className="jf-card__body"><fieldset className="jf-email-fieldset jf-stack" disabled={!canManage || busy}><div className="jf-grid jf-grid--2">
      {([['companyName','Company / site name'],['logoUrl','Logo URL'],['darkLogoUrl','Dark-background logo URL'],['supportContact','Support contact'],['address','Company address'],['fontFamily','Safe font stack']] as const).map(([key,label]) => <label className="jf-field" key={key}><span className="jf-field__label">{label}</span><input className="jf-input" value={String(design[key])} onChange={(e) => setDesign({ ...design, [key]: e.target.value })} /></label>)}
      {([['accentColor','Accent'],['pageBackground','Page background'],['contentBackground','Content background'],['textColor','Text']] as const).map(([key,label]) => <label className="jf-field" key={key}><span className="jf-field__label">{label}</span><input className="jf-input" type="color" value={String(design[key])} onChange={(e) => setDesign({ ...design, [key]: e.target.value })} /></label>)}
      <label className="jf-field"><span className="jf-field__label">Content width</span><input className="jf-input" type="number" min="320" max="800" value={design.contentWidth} onChange={(e) => setDesign({ ...design, contentWidth: Number(e.target.value) })} /></label><label className="jf-field"><span className="jf-field__label">Corner radius</span><input className="jf-input" type="number" min="0" max="48" value={design.radius} onChange={(e) => setDesign({ ...design, radius: Number(e.target.value) })} /></label>
    </div><label className="jf-field"><span className="jf-field__label">Footer text</span><textarea className="jf-input" rows={4} value={design.footerText} onChange={(e) => setDesign({ ...design, footerText: e.target.value })} /></label><div className="jf-row jf-email-actions"><button type="button" className="jf-btn jf-btn--ghost" onClick={() => void restoreDesign()} disabled={busy}>Reset to defaults</button><span className="jf-email-actions__spacer" /><button type="button" className="jf-btn jf-btn--ghost" onClick={() => void saveDesign(false)} disabled={busy}>{busy ? "Saving…" : "Save draft"}</button><button type="button" className="jf-btn jf-btn--primary" onClick={() => void saveDesign(true)} disabled={busy}>{busy ? "Publishing…" : "Publish design"}</button></div></fieldset></div></section><PreviewPane preview={preview} view={view} setView={setView} /></div> :
    <div className="jf-email-layout"><aside className="jf-card jf-email-list"><div className="jf-card__head"><h2 className="jf-card__title">Templates</h2><span className="jf-badge jf-badge--info">{filtered.length}</span></div><div className="jf-email-list__search"><label className="jf-field"><span className="jf-sr-only">Search templates</span><input className="jf-input" type="search" placeholder="Search templates…" value={query} onChange={(e) => setQuery(e.target.value)} /></label></div><div className="jf-email-list__items">{filtered.map((item) => <button type="button" key={item.key} className="jf-email-list__item" aria-current={selected === item.key ? "true" : undefined} onClick={() => setSelected(item.key)}><span className="jf-email-list__identity"><strong>{item.label}</strong><small>{item.description}</small></span><span className="jf-email-list__meta"><span className={`jf-email-list__status jf-email-list__status--${item.current.status}`}>{item.current.status}</span><span className="jf-email-list__version">v{item.current.version}</span></span></button>)}</div></aside><div className="jf-email-editor"><main className="jf-card"><div className="jf-card__head"><div><h2 className="jf-card__title">{definition?.label}</h2><p className="jf-field__hint">{definition?.description}</p></div><div className="jf-row"><span className="jf-badge jf-badge--info">{payload.locale}</span><span className="jf-badge jf-badge--info">{definition?.owner}</span><span className="jf-badge">{definition?.purpose}</span></div></div><div className="jf-card__body"><fieldset className="jf-email-fieldset jf-stack" disabled={!canManage || busy}><label className="jf-field"><span className="jf-field__label">Recipient</span><input className="jf-input" value={definition?.recipient ?? ""} disabled /></label>
      <label className="jf-field"><span className="jf-field__label">Subject</span><input className="jf-input" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></label><label className="jf-field"><span className="jf-field__label">Preheader</span><input className="jf-input" value={draft.preheader} onChange={(e) => setDraft({ ...draft, preheader: e.target.value })} /></label><label className="jf-field"><span className="jf-field__label">HTML content</span><textarea className="jf-input jf-email-code" rows={14} value={draft.html} onChange={(e) => setDraft({ ...draft, html: e.target.value })} /></label><label className="jf-field"><span className="jf-field__label">Plain-text companion</span><textarea className="jf-input jf-email-code" rows={9} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} /></label>
      <details className="jf-email-variables"><summary>Available variables <span className="jf-badge jf-badge--info">{definition?.variables.length}</span></summary><dl>{definition?.variables.map((variable) => <div key={variable.key}><dt><code className="jf-code">{`{{${variable.key}}}`}</code>{variable.required && <span className="jf-email-variables__req">Required</span>}</dt><dd>{variable.description}<span className="jf-email-variables__example">Example: {variable.example}</span></dd></div>)}</dl></details><div className="jf-grid jf-grid--2"><label className="jf-field"><span className="jf-field__label">Sender display name (optional)</span><input className="jf-input" value={draft.senderName} onChange={(e) => setDraft({ ...draft, senderName: e.target.value })} /></label><label className="jf-field"><span className="jf-field__label">Reply-to policy</span><select className="jf-input" value={draft.replyToPolicy} onChange={(e) => setDraft({ ...draft, replyToPolicy: e.target.value as "global" | "none" })}><option value="global">Use global setting</option><option value="none">No reply-to</option></select></label></div>{definition?.disableSafe && <label className="jf-checkrow"><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /><span>Enabled</span></label>}
      <div className="jf-row jf-email-actions"><button type="button" className="jf-btn jf-btn--ghost" onClick={() => void restore()} disabled={busy}>Restore default</button><span className="jf-email-actions__spacer" /><button type="button" className="jf-btn jf-btn--ghost" onClick={() => void saveTemplate(false)} disabled={busy}>{busy ? "Saving…" : "Save draft"}</button><button type="button" className="jf-btn jf-btn--primary" onClick={() => void saveTemplate(true)} disabled={busy}>{busy ? "Publishing…" : "Publish"}</button></div></fieldset></div></main><section className="jf-card"><div className="jf-card__head"><div><h2 className="jf-card__title">Send a test</h2><p className="jf-field__hint">Uses synthetic preview data and the current draft.</p></div></div><div className="jf-card__body"><div className="jf-email-test"><label className="jf-field"><span className="jf-field__label">Authorized recipient</span><input className="jf-input" type="email" placeholder="you@example.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} /></label><button type="button" className="jf-btn jf-btn--ghost" onClick={() => void sendTest()} disabled={!testTo || busy}>{busy ? "Sending…" : "Send test"}</button></div></div></section></div><PreviewPane preview={preview} view={view} setView={setView} /></div>}
  </div>;
}

function PreviewPane({ preview, view, setView }: { preview: Preview | null; view: "desktop" | "mobile" | "text"; setView: (value: "desktop" | "mobile" | "text") => void }) {
  return <section className="jf-card jf-email-preview"><div className="jf-card__head"><div><h2 className="jf-card__title">Preview</h2><p className="jf-field__hint">Synthetic data only — no secrets or live recipients.</p></div><div className="jf-row" role="group" aria-label="Preview mode"><button type="button" className={`jf-btn jf-btn--sm ${view === "desktop" ? "jf-btn--primary" : "jf-btn--ghost"}`} aria-pressed={view === "desktop"} onClick={() => setView("desktop")}>Desktop</button><button type="button" className={`jf-btn jf-btn--sm ${view === "mobile" ? "jf-btn--primary" : "jf-btn--ghost"}`} aria-pressed={view === "mobile"} onClick={() => setView("mobile")}>Mobile</button><button type="button" className={`jf-btn jf-btn--sm ${view === "text" ? "jf-btn--primary" : "jf-btn--ghost"}`} aria-pressed={view === "text"} onClick={() => setView("text")}>Plain text</button></div></div><div className="jf-card__body jf-card__body--flush">{preview?.fallback && <div className="jf-alert jf-email-preview__alert">Showing the safe built-in fallback.</div>}<div className="jf-email-preview__canvas">{view === "text" ? <pre className="jf-email-text-preview">{preview?.text}</pre> : <iframe title="Rendered email preview" sandbox="" srcDoc={preview?.html ?? ""} style={{ width: view === "mobile" ? 390 : "100%", maxWidth: "100%", height: 650, border: 0, margin: "0 auto", display: "block" }} />}</div></div></section>;
}
