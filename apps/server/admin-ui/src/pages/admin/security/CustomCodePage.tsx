// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import { LoadError, PageSkeleton, SaveBar, Section } from "./components";
import { useT } from "../../../i18n/I18nProvider";

type Placement = "head" | "bodyStart" | "bodyEnd";
type Kind = "library" | "inline" | "external" | "markup";
type Consent = "necessary" | "preferences" | "analytics" | "marketing";

interface Snippet {
  id?: string;
  name: string;
  enabled: boolean;
  placement: Placement;
  kind: Kind;
  code?: string;
  src?: string;
  defer?: boolean;
  library?: { id: string; values: Record<string, string> };
  scope: { type: "site" } | { type: "pages"; contentIds: string[] };
  consent: Consent;
  environments: string[];
  updatedAt?: string;
}

interface Config {
  safeMode: boolean;
  allowedOrigins: string[];
  snippets: Snippet[];
}

interface LibraryTemplate {
  id: string;
  name: string;
  description: string;
  consent: Consent;
  params: Array<{ id: string; label: string; example: string; optional: boolean }>;
}

interface Payload {
  config: Config;
  library: LibraryTemplate[];
  environment: string;
  disabledByEnvironment: boolean;
  versions: Array<{ version: number; savedAt: string; savedBy: string | null }>;
}

const PLACEMENTS: Placement[] = ["head", "bodyStart", "bodyEnd"];
const KINDS: Kind[] = ["library", "inline", "external", "markup"];
const CONSENT: Consent[] = ["necessary", "preferences", "analytics", "marketing"];

const lines = (value: string) => value.split(/[\r\n,]+/).map((line) => line.trim()).filter(Boolean);

function emptySnippet(library: LibraryTemplate[]): Snippet {
  const first = library[0];
  return {
    name: first?.name ?? "",
    enabled: true,
    placement: "head",
    kind: "library",
    library: { id: first?.id ?? "", values: {} },
    scope: { type: "site" },
    consent: first?.consent ?? "analytics",
    environments: [],
  };
}

/**
 * Custom JavaScript and markup on public pages (justflows-ce#94). Only people
 * with the `code:manage` capability reach this page or its API. The server
 * validates every change, allows inline scripts by hash in the Content
 * Security Policy, and audits each save with a diff.
 */
export default function CustomCodePage() {
  const { t } = useT();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [origins, setOrigins] = useState("");
  const [pages, setPages] = useState<Array<{ id: string; title: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const load = (data: Payload) => {
    setPayload(data);
    setDraft(data.config);
    setOrigins(data.config.allowedOrigins.join("\n"));
  };

  useEffect(() => {
    void fetch("/api/custom-code")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || t("security.customCode.loadFailed"));
        load(body as Payload);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    void fetch("/api/content?type=page&limit=100")
      .then(async (response) => (response.ok ? response.json() : { items: [] }))
      .then((body: { items?: Array<{ id: string; title: string }> }) => setPages(body.items ?? []))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const candidate: Config | null = draft ? { ...draft, allowedOrigins: lines(origins) } : null;
  const dirty = Boolean(payload && candidate && JSON.stringify(candidate) !== JSON.stringify(payload.config));

  /** Ask the server for errors and warnings while the draft changes. */
  useEffect(() => {
    if (!candidate || !dirty) {
      setProblems([]);
      setWarnings([]);
      return;
    }
    const timer = setTimeout(() => {
      void fetch("/api/custom-code/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(candidate) })
        .then((response) => response.json())
        .then((body: { errors?: string[]; warnings?: string[] }) => {
          setProblems(body.errors ?? []);
          setWarnings(body.warnings ?? []);
        })
        .catch(() => undefined);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(candidate), dirty]);

  if (!payload && !error) return <PageSkeleton />;
  if (!payload || !draft || !candidate) return <LoadError error={error ?? t("security.shared.unknownError")} />;

  const update = (index: number, patch: Partial<Snippet>) =>
    setDraft({ ...draft, snippets: draft.snippets.map((snippet, i) => (i === index ? { ...snippet, ...patch } : snippet)) });

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/custom-code", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(candidate) });
      const body = await response.json();
      if (!response.ok) {
        setProblems(body.errors ?? []);
        throw new Error(body.error || t("security.customCode.saveFailed"));
      }
      const refreshed = await (await fetch("/api/custom-code")).json();
      load(refreshed as Payload);
      setWarnings(body.warnings ?? []);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function setSafeMode(enabled: boolean) {
    if (enabled && !confirm(t("security.customCode.safeModeConfirm"))) return;
    const response = await fetch("/api/custom-code/safe-mode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || t("security.customCode.saveFailed"));
      return;
    }
    const refreshed = await (await fetch("/api/custom-code")).json();
    load(refreshed as Payload);
  }

  const libraryById = new Map(payload.library.map((template) => [template.id, template]));

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("security.customCode.title")}</h1>
          <p>{t("security.customCode.subtitle")}</p>
        </div>
      </header>

      {payload.disabledByEnvironment && (
        <div className="jf-alert jf-alert--warning" role="status">{t("security.customCode.disabledByEnvironment")}</div>
      )}

      <Section
        title={t("security.customCode.safeMode.title")}
        action={
          <button className={`jf-btn ${payload.config.safeMode ? "jf-btn--primary" : "jf-btn--danger"}`} onClick={() => void setSafeMode(!payload.config.safeMode)}>
            {payload.config.safeMode ? t("security.customCode.safeMode.off") : t("security.customCode.safeMode.on")}
          </button>
        }
      >
        <p className="jf-field__hint">
          {payload.config.safeMode ? t("security.customCode.safeMode.active") : t("security.customCode.safeMode.hint")}
        </p>
      </Section>

      <Section
        title={t("security.customCode.snippets.title")}
        action={
          <button
            className="jf-btn jf-btn--secondary"
            onClick={() => {
              setDraft({ ...draft, snippets: [...draft.snippets, emptySnippet(payload.library)] });
              setOpen(draft.snippets.length);
            }}
          >
            {t("security.customCode.snippets.add")}
          </button>
        }
      >
        <p className="jf-field__hint">{t("security.customCode.snippets.hint", { environment: payload.environment })}</p>
        {draft.snippets.length === 0 && <p className="jf-meta">{t("security.customCode.snippets.empty")}</p>}
        <div className="jf-stack">
          {draft.snippets.map((snippet, index) => {
            const template = snippet.library ? libraryById.get(snippet.library.id) : undefined;
            const id = `snippet-${index}`;
            return (
              <div key={snippet.id ?? `new-${index}`} className="jf-card">
                <div className="jf-card__body jf-stack">
                  <div className="jf-row" style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                    <label className="jf-checkrow">
                      <input type="checkbox" checked={snippet.enabled} onChange={(e) => update(index, { enabled: e.target.checked })} />
                      <span>{t("security.customCode.snippet.enabled")}</span>
                    </label>
                    <strong style={{ flex: 1 }}>{snippet.name || t("security.customCode.snippet.untitled")}</strong>
                    <span className="jf-meta">
                      {t(`security.customCode.kinds.${snippet.kind}`)} · {t(`security.customCode.placements.${snippet.placement}`)} · {t(`security.customCode.consent.${snippet.consent}`)}
                    </span>
                    <button className="jf-btn jf-btn--ghost" onClick={() => setOpen(open === index ? null : index)}>
                      {open === index ? t("security.customCode.snippet.close") : t("security.customCode.snippet.edit")}
                    </button>
                    <button
                      className="jf-btn jf-btn--danger"
                      onClick={() => setDraft({ ...draft, snippets: draft.snippets.filter((_, i) => i !== index) })}
                    >
                      {t("common.delete")}
                    </button>
                  </div>
                  {open === index && (
                    <div className="jf-stack">
                      <label className="jf-field">
                        <span className="jf-field__label">{t("security.customCode.snippet.name")}</span>
                        <input className="jf-input" value={snippet.name} onChange={(e) => update(index, { name: e.target.value })} />
                      </label>
                      <div className="jf-row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
                        <label className="jf-field">
                          <span className="jf-field__label">{t("security.customCode.snippet.kind")}</span>
                          <select className="jf-input" value={snippet.kind} onChange={(e) => update(index, { kind: e.target.value as Kind })}>
                            {KINDS.map((kind) => <option key={kind} value={kind}>{t(`security.customCode.kinds.${kind}`)}</option>)}
                          </select>
                        </label>
                        <label className="jf-field">
                          <span className="jf-field__label">{t("security.customCode.snippet.placement")}</span>
                          <select className="jf-input" value={snippet.placement} onChange={(e) => update(index, { placement: e.target.value as Placement })}>
                            {PLACEMENTS.map((placement) => <option key={placement} value={placement}>{t(`security.customCode.placements.${placement}`)}</option>)}
                          </select>
                        </label>
                        <label className="jf-field">
                          <span className="jf-field__label">{t("security.customCode.snippet.consent")}</span>
                          <select className="jf-input" value={snippet.consent} onChange={(e) => update(index, { consent: e.target.value as Consent })}>
                            {CONSENT.map((consent) => <option key={consent} value={consent}>{t(`security.customCode.consent.${consent}`)}</option>)}
                          </select>
                        </label>
                      </div>
                      <p className="jf-field__hint">{t("security.customCode.snippet.consentHint")}</p>

                      {snippet.kind === "library" && (
                        <div className="jf-stack">
                          <label className="jf-field">
                            <span className="jf-field__label">{t("security.customCode.snippet.library")}</span>
                            <select
                              className="jf-input"
                              value={snippet.library?.id ?? ""}
                              onChange={(e) => {
                                const next = libraryById.get(e.target.value);
                                update(index, { library: { id: e.target.value, values: {} }, ...(next ? { consent: next.consent, name: snippet.name || next.name } : {}) });
                              }}
                            >
                              {payload.library.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                          </label>
                          {template && <p className="jf-field__hint">{template.description}</p>}
                          {template?.params.map((param) => (
                            <label key={param.id} className="jf-field">
                              <span className="jf-field__label">{param.label}{param.optional ? ` (${t("security.customCode.snippet.optional")})` : ""}</span>
                              <input
                                className="jf-input"
                                placeholder={param.example}
                                value={snippet.library?.values[param.id] ?? ""}
                                onChange={(e) => update(index, { library: { id: template.id, values: { ...(snippet.library?.values ?? {}), [param.id]: e.target.value } } })}
                              />
                            </label>
                          ))}
                        </div>
                      )}
                      {snippet.kind === "external" && (
                        <label className="jf-field">
                          <span className="jf-field__label">{t("security.customCode.snippet.src")}</span>
                          <input className="jf-input" placeholder="https://" value={snippet.src ?? ""} onChange={(e) => update(index, { src: e.target.value })} />
                        </label>
                      )}
                      {(snippet.kind === "inline" || snippet.kind === "markup") && (
                        <label className="jf-field">
                          <span className="jf-field__label">
                            {snippet.kind === "inline" ? t("security.customCode.snippet.script") : t("security.customCode.snippet.markup")}
                          </span>
                          <textarea
                            className="jf-input"
                            rows={8}
                            spellCheck={false}
                            style={{ fontFamily: "monospace" }}
                            value={snippet.code ?? ""}
                            onChange={(e) => update(index, { code: e.target.value })}
                          />
                          <span className="jf-field__hint">
                            {snippet.kind === "inline" ? t("security.customCode.snippet.scriptHint") : t("security.customCode.snippet.markupHint")}
                          </span>
                        </label>
                      )}

                      <label className="jf-field">
                        <span className="jf-field__label">{t("security.customCode.snippet.scope")}</span>
                        <select
                          className="jf-input"
                          value={snippet.scope.type}
                          onChange={(e) => update(index, { scope: e.target.value === "site" ? { type: "site" } : { type: "pages", contentIds: [] } })}
                        >
                          <option value="site">{t("security.customCode.snippet.scopeSite")}</option>
                          <option value="pages">{t("security.customCode.snippet.scopePages")}</option>
                        </select>
                      </label>
                      {snippet.scope.type === "pages" && (
                        <select
                          className="jf-input"
                          multiple
                          size={Math.min(8, Math.max(3, pages.length))}
                          aria-label={t("security.customCode.snippet.scopePages")}
                          value={snippet.scope.contentIds}
                          onChange={(e) => update(index, { scope: { type: "pages", contentIds: Array.from(e.target.selectedOptions).map((option) => option.value) } })}
                        >
                          {pages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                        </select>
                      )}
                      <label className="jf-field">
                        <span className="jf-field__label">{t("security.customCode.snippet.environments")}</span>
                        <input
                          id={`${id}-env`}
                          className="jf-input"
                          placeholder="production"
                          value={snippet.environments.join(", ")}
                          onChange={(e) => update(index, { environments: lines(e.target.value) })}
                        />
                        <span className="jf-field__hint">{t("security.customCode.snippet.environmentsHint")}</span>
                      </label>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={t("security.customCode.origins.title")}>
        <p className="jf-field__hint">{t("security.customCode.origins.hint")}</p>
        <textarea
          className="jf-input"
          rows={4}
          spellCheck={false}
          aria-label={t("security.customCode.origins.title")}
          placeholder="https://cdn.example.com"
          value={origins}
          onChange={(e) => setOrigins(e.target.value)}
        />
      </Section>

      {problems.length > 0 && (
        <div className="jf-alert jf-alert--error" role="alert">
          <ul>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="jf-alert jf-alert--warning" role="status">
          <strong>{t("security.customCode.warnings")}</strong>
          <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      )}

      <SaveBar
        dirty={dirty}
        saving={saving}
        saved={saved}
        error={error}
        onSave={() => void save()}
        onDiscard={() => load(payload)}
      />

      <Section title={t("security.customCode.history.title")}>
        {payload.versions.length === 0 ? (
          <p className="jf-meta">{t("security.customCode.history.empty")}</p>
        ) : (
          <ul className="jf-stack" style={{ listStyle: "none", padding: 0 }}>
            {payload.versions.map((entry) => (
              <li key={entry.version} className="jf-meta">
                {t("security.customCode.history.entry", { version: entry.version, date: new Date(entry.savedAt).toLocaleString() })}
              </li>
            ))}
          </ul>
        )}
        <p className="jf-field__hint">{t("security.customCode.history.hint")}</p>
      </Section>
    </div>
  );
}
