import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useSecurityConfig } from "./useSecurityConfig";
import {
  GradeBadge,
  KillSwitchNotice,
  LoadError,
  PageSkeleton,
  SaveBar,
  ScopeSelect,
} from "./components";
import { ChoiceEditor, CspEditor, HstsEditor, PermissionsEditor, RawEditor } from "./editors";
import type { HeaderEntry, SecurityHeaderDef, SecurityHeaderId } from "./types";
import { useT } from "../../../i18n/I18nProvider";

export default function SecurityHeadersPage() {
  const { t } = useT();
  const state = useSecurityConfig();
  const { hash } = useLocation();
  const [rawMode, setRawMode] = useState<Set<SecurityHeaderId>>(new Set());
  const [highlighted, setHighlighted] = useState<string | null>(null);

  // Findings on the Overview page link straight at a header.
  useEffect(() => {
    if (!hash || state.loading) return;
    const id = hash.slice(1);
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlighted(id);
    const timer = setTimeout(() => setHighlighted(null), 2400);
    return () => clearTimeout(timer);
  }, [hash, state.loading]);

  if (state.loading) return <PageSkeleton />;
  if (!state.payload || !state.draft || !state.audit) {
    return <LoadError error={state.error ?? t("security.shared.unknownError")} />;
  }

  const { draft, payload } = state;

  const patch = (id: SecurityHeaderId, changes: Partial<HeaderEntry>) =>
    state.setDraft((config) => {
      config.headers[id] = { ...config.headers[id], ...changes };
      return config;
    });

  const toggleRaw = (id: SecurityHeaderId) =>
    setRawMode((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("security.headers.title")}</h1>
          <p>
            {t("security.headers.subtitle")}
          </p>
        </div>
        <div className="jf-pagehead__actions">
          <GradeBadge audit={state.audit} live={state.dirty} />
        </div>
      </header>

      {payload.killSwitch && <KillSwitchNotice />}

      {payload.catalog.map((def) => {
        const entry = draft.headers[def.id];
        if (!entry) return null;
        return (
          <HeaderCard
            key={def.id}
            def={def}
            entry={entry}
            highlighted={highlighted === def.id}
            raw={rawMode.has(def.id)}
            onToggleRaw={() => toggleRaw(def.id)}
            onChange={(changes) => patch(def.id, changes)}
            onResetValue={() =>
              patch(def.id, { value: payload.defaults.headers[def.id]?.value ?? def.defaultValue })
            }
          />
        );
      })}

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

function HeaderCard({
  def,
  entry,
  raw,
  highlighted,
  onToggleRaw,
  onChange,
  onResetValue,
}: {
  def: SecurityHeaderDef;
  entry: HeaderEntry;
  raw: boolean;
  highlighted: boolean;
  onToggleRaw: () => void;
  onChange: (changes: Partial<HeaderEntry>) => void;
  onResetValue: () => void;
}) {
  const { t } = useT();
  const structured = def.editor !== "text";
  const showRaw = raw || !structured;

  const wireName =
    (def.id === "content_security_policy" || def.id === "content_security_policy_admin") &&
    entry.mode === "report-only"
      ? "Content-Security-Policy-Report-Only"
      : def.header;

  return (
    <div
      className={`jf-card${entry.enabled ? " jf-card--active" : ""}`}
      id={def.id}
      style={highlighted ? { outline: "2px solid var(--jf-accent, #4f46e5)" } : undefined}
    >
      <div className="jf-card__head">
        <h2 className="jf-card__title">
          {def.title}
          {def.recommended && !entry.enabled && <span className="jf-chip">{t("security.shared.recommended")}</span>}
        </h2>
        <label className="jf-checkrow">
          <input
            type="checkbox"
            checked={entry.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />
          <span>{entry.enabled ? t("security.headers.card.on") : t("security.headers.card.off")}</span>
        </label>
      </div>

      <div className="jf-card__body jf-stack">
        <p className="jf-field__hint">{def.description}</p>

        {entry.enabled && (
          <>
            {showRaw ? (
              <RawEditor def={def} entry={entry} onChange={onChange} />
            ) : def.editor === "choice" ? (
              <ChoiceEditor def={def} entry={entry} onChange={onChange} />
            ) : def.editor === "hsts" ? (
              <HstsEditor def={def} entry={entry} onChange={onChange} />
            ) : def.editor === "csp" ? (
              <CspEditor def={def} entry={entry} onChange={onChange} />
            ) : (
              <PermissionsEditor def={def} entry={entry} onChange={onChange} />
            )}

            <ScopeSelect
              id={`${def.id}-scope`}
              value={entry.scope}
              onChange={(scope) => onChange({ scope })}
            />

            <div className="jf-meta">
              <div className="jf-meta__row">
                <span className="jf-field__label">{t("security.headers.card.sentAs")}</span>
                <code className="jf-code jf-truncate">
                  {wireName}: {entry.value || t("security.headers.card.empty")}
                </code>
              </div>
            </div>
          </>
        )}

        <div className="jf-row">
          <a className="jf-btn jf-btn--quiet" href={def.docs} target="_blank" rel="noreferrer noopener">
            {t("security.headers.card.reference")}
          </a>
          {entry.enabled && structured && (
            <button type="button" className="jf-btn jf-btn--quiet" onClick={onToggleRaw}>
              {raw ? t("security.headers.card.useGuided") : t("security.headers.card.editRaw")}
            </button>
          )}
          {entry.enabled && (
            <button type="button" className="jf-btn jf-btn--quiet" onClick={onResetValue}>
              {t("security.headers.card.resetDefault")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
