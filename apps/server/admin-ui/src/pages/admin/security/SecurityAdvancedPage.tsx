import { useState } from "react";
import { useSecurityConfig } from "./useSecurityConfig";
import {
  GradeBadge,
  HeaderPreview,
  KillSwitchNotice,
  LoadError,
  PageSkeleton,
  SaveBar,
  ScopeSelect,
  Section,
} from "./components";
import { SCOPE_LABELS, type CustomHeader, type HeaderScope, type SecurityHeadersConfig } from "./types";

/**
 * Headers that frame the response body. The server refuses them too — listing
 * them here means the admin finds out before they hit Save.
 */
const PROTECTED_NAMES = new Set([
  "content-length",
  "content-type",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "trailer",
  "te",
  "host",
  "date",
  "location",
  "set-cookie",
]);

export default function SecurityAdvancedPage() {
  const state = useSecurityConfig();
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  if (state.loading) return <PageSkeleton />;
  if (!state.payload || !state.draft) {
    return <LoadError error={state.error ?? "Unknown error"} />;
  }

  const { draft, payload } = state;

  const setCustom = (next: CustomHeader[]) =>
    state.setDraft((config) => {
      config.custom = next;
      return config;
    });

  const knownHeaderNames = new Set(payload.catalog.map((d) => d.header.toLowerCase()));

  function problemWith(header: CustomHeader, index: number): string | null {
    const name = header.name.trim();
    if (!name) return "Give the header a name.";
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) return "That is not a valid header name.";
    if (PROTECTED_NAMES.has(name.toLowerCase())) {
      return "This header controls the response body and cannot be overridden here.";
    }
    if (knownHeaderNames.has(name.toLowerCase())) {
      return "This header has its own settings page — configure it there instead.";
    }
    if (draft.custom.some((h, i) => i !== index && h.name.trim().toLowerCase() === name.toLowerCase())) {
      return "Another row already sets this header.";
    }
    if (/[\r\n]/.test(header.value)) return "Header values cannot contain line breaks.";
    return null;
  }

  function applyImport() {
    setImportError(null);
    try {
      const parsed = JSON.parse(importText) as SecurityHeadersConfig;
      if (!parsed || typeof parsed !== "object" || !parsed.headers) {
        setImportError("That does not look like a Justflows security configuration.");
        return;
      }
      state.replaceDraft(parsed);
      setImportText("");
    } catch (e) {
      setImportError(`Could not read the JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const exportJson = JSON.stringify(draft, null, 2);

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>Advanced security</h1>
          <p>Custom response headers, the exact output, and moving a configuration between sites.</p>
        </div>
        <div className="jf-pagehead__actions">
          {state.audit && <GradeBadge audit={state.audit} live={state.dirty} />}
        </div>
      </header>

      {payload.killSwitch && <KillSwitchNotice />}

      <Section
        title="Custom response headers"
        action={
          <button
            className="jf-btn jf-btn--ghost"
            onClick={() =>
              setCustom([...draft.custom, { name: "", value: "", enabled: true, scope: "all" }])
            }
            disabled={draft.custom.length >= 50}
          >
            Add header
          </button>
        }
      >
        <p className="jf-field__hint">
          Anything the pages above do not cover — a reporting endpoint, a vendor header, something
          new that browsers have only just shipped. These are sent exactly as written.
        </p>

        {draft.custom.length === 0 ? (
          <div className="jf-empty">
            <div className="jf-empty__icon" aria-hidden="true">
              ⌗
            </div>
            <div className="jf-empty__title">No custom headers</div>
          </div>
        ) : (
          <div className="jf-stack jf-stack--sm">
            {draft.custom.map((header, index) => {
              const problem = problemWith(header, index);
              return (
                <div key={index} className="jf-card">
                  <div className="jf-card__body jf-stack jf-stack--sm">
                    <div className="jf-itemrow">
                      <div className="jf-field" style={{ flex: "0 0 18rem" }}>
                        <label className="jf-field__label" htmlFor={`custom-name-${index}`}>
                          Header name
                        </label>
                        <input
                          id={`custom-name-${index}`}
                          className={`jf-input jf-input--mono${problem ? " jf-input--invalid" : ""}`}
                          value={header.name}
                          placeholder="Reporting-Endpoints"
                          onChange={(e) => {
                            const next = [...draft.custom];
                            next[index] = { ...header, name: e.target.value };
                            setCustom(next);
                          }}
                        />
                      </div>
                      <div className="jf-field" style={{ flex: 1 }}>
                        <label className="jf-field__label" htmlFor={`custom-value-${index}`}>
                          Value
                        </label>
                        <input
                          id={`custom-value-${index}`}
                          className="jf-input jf-input--mono"
                          value={header.value}
                          placeholder='default="https://example.com/reports"'
                          onChange={(e) => {
                            const next = [...draft.custom];
                            next[index] = { ...header, value: e.target.value };
                            setCustom(next);
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        className="jf-iconbtn jf-iconbtn--danger"
                        aria-label={`Remove ${header.name || "header"}`}
                        onClick={() => setCustom(draft.custom.filter((_, i) => i !== index))}
                      >
                        ✕
                      </button>
                    </div>

                    <div className="jf-grid jf-grid--2">
                      <ScopeSelect
                        id={`custom-scope-${index}`}
                        value={header.scope}
                        onChange={(scope: HeaderScope) => {
                          const next = [...draft.custom];
                          next[index] = { ...header, scope };
                          setCustom(next);
                        }}
                      />
                      <label className="jf-checkrow jf-checkrow--stacked">
                        <input
                          type="checkbox"
                          checked={header.enabled}
                          onChange={(e) => {
                            const next = [...draft.custom];
                            next[index] = { ...header, enabled: e.target.checked };
                            setCustom(next);
                          }}
                        />
                        <span>
                          Send this header
                          <span className="jf-checkrow__meta">
                            {header.enabled
                              ? `Active for: ${SCOPE_LABELS[header.scope].toLowerCase()}.`
                              : "Kept here but not sent."}
                          </span>
                        </span>
                      </label>
                    </div>

                    {problem && <p className="jf-status jf-status--error">{problem}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Server identification">
        <label className="jf-checkrow jf-checkrow--stacked">
          <input
            type="checkbox"
            checked={draft.removeServerHeader}
            onChange={(e) =>
              state.setDraft((config) => {
                config.removeServerHeader = e.target.checked;
                return config;
              })
            }
          />
          <span>
            Strip the <code>Server</code> header
            <span className="jf-checkrow__meta">
              Hides the web server name and version that a proxy in front of Justflows may add.
              Justflows sends <code>X-Powered-By: Justflows</code> (not Express). This is
              obscurity for the underlying stack — not a defence — but it does make you a
              less obvious target for scripted scans aimed at specific servers.
            </span>
          </span>
        </label>
      </Section>

      <Section title="What gets sent">
        <div className="jf-stack jf-stack--sm">
          <h3 className="jf-section-title">Public site over HTTPS</h3>
          {state.effective && <HeaderPreview headers={state.effective.publicSecure} />}
          <h3 className="jf-section-title">Admin &amp; API</h3>
          {state.effective && <HeaderPreview headers={state.effective.admin} />}
        </div>
      </Section>

      <Section title="Move this configuration">
        <div className="jf-field">
          <label className="jf-field__label" htmlFor="security-export">
            Current configuration
          </label>
          <textarea
            id="security-export"
            className="jf-input jf-input--mono"
            rows={8}
            readOnly
            value={exportJson}
            onFocus={(e) => e.currentTarget.select()}
          />
          <p className="jf-field__hint">
            Copy this to reproduce the same policy on another Justflows site.
          </p>
        </div>

        <div className="jf-field">
          <label className="jf-field__label" htmlFor="security-import">
            Paste a configuration to load
          </label>
          <textarea
            id="security-import"
            className="jf-input jf-input--mono"
            rows={6}
            value={importText}
            placeholder="{ &quot;headers&quot;: { … } }"
            onChange={(e) => setImportText(e.target.value)}
          />
          {importError && <p className="jf-status jf-status--error">{importError}</p>}
          <div className="jf-row">
            <button
              className="jf-btn jf-btn--ghost"
              onClick={applyImport}
              disabled={!importText.trim()}
            >
              Load into the editor
            </button>
            <span className="jf-field__hint">
              Loaded for review only — nothing changes until you save.
            </span>
          </div>
        </div>
      </Section>

      <Section title="Start over">
        <p className="jf-field__hint">
          Restores the headers Justflows ships with: X-Frame-Options, X-Content-Type-Options,
          Referrer-Policy and HSTS on, everything else off, and no custom headers. This saves
          immediately.
        </p>
        <div className="jf-row">
          {confirmingReset ? (
            <>
              <button
                className="jf-btn jf-btn--danger"
                onClick={() => {
                  setConfirmingReset(false);
                  void state.resetToDefaults();
                }}
                disabled={state.saving}
              >
                Yes, reset everything
              </button>
              <button className="jf-btn jf-btn--ghost" onClick={() => setConfirmingReset(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="jf-btn jf-btn--danger" onClick={() => setConfirmingReset(true)}>
              Reset to defaults
            </button>
          )}
        </div>
      </Section>

      <Section title="If a policy locks you out">
        <p className="jf-field__hint">
          A Content Security Policy strict enough to break the admin would normally leave you with no
          way in to fix it. Set <code>JF_SECURITY_HEADERS_DISABLED=1</code> in the environment and
          restart: the site falls back to the built-in defaults, this screen keeps working, and your
          saved configuration is left untouched so you can correct it and remove the variable again.
        </p>
      </Section>

      <SaveBar
        dirty={state.dirty}
        saving={state.saving}
        saved={state.saved}
        error={state.error}
        onSave={() => void state.save()}
        onDiscard={state.discard}
      />
    </div>
  );
}
