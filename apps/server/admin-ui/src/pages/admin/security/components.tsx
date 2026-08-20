import type { ReactNode } from "react";
import {
  SCOPE_HINTS,
  SCOPE_LABELS,
  type FindingLevel,
  type HeaderScope,
  type ResolvedHeader,
  type SecurityAudit,
} from "./types";

/** Grade → the badge modifier that carries the right colour. */
const GRADE_TONE: Record<SecurityAudit["grade"], string> = {
  "A+": "jf-badge--ok",
  A: "jf-badge--ok",
  B: "jf-badge--ok",
  C: "jf-badge--warn",
  D: "jf-badge--warn",
  E: "jf-badge--error",
  F: "jf-badge--error",
};

const LEVEL_TONE: Record<FindingLevel, string> = {
  critical: "jf-badge--error",
  warning: "jf-badge--warn",
  info: "jf-badge--info",
  pass: "jf-badge--ok",
};

const LEVEL_ICON: Record<FindingLevel, string> = {
  critical: "✕",
  warning: "!",
  info: "i",
  pass: "✓",
};

const LEVEL_LABEL: Record<FindingLevel, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Suggestion",
  pass: "Protected",
};

export function GradeBadge({ audit, live }: { audit: SecurityAudit; live?: boolean }) {
  return (
    <span
      className={`jf-badge ${GRADE_TONE[audit.grade]}`}
      title={`Score ${audit.score} of 100`}
    >
      Grade {audit.grade} · {audit.score}/100{live ? " (unsaved)" : ""}
    </span>
  );
}

export function LevelBadge({ level }: { level: FindingLevel }) {
  return (
    <span className={`jf-badge ${LEVEL_TONE[level]}`}>
      {LEVEL_ICON[level]} {LEVEL_LABEL[level]}
    </span>
  );
}

export function Section({
  title,
  action,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="jf-card">
      <div className="jf-card__head">
        <h2 className="jf-card__title">{title}</h2>
        {action}
      </div>
      <div className="jf-card__body jf-stack">{children}</div>
    </div>
  );
}

export function ScopeSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: HeaderScope;
  onChange: (scope: HeaderScope) => void;
}) {
  return (
    <div className="jf-field">
      <label className="jf-field__label" htmlFor={id}>
        Applies to
      </label>
      <select
        id={id}
        className="jf-input"
        value={value}
        onChange={(e) => onChange(e.target.value as HeaderScope)}
      >
        {(Object.keys(SCOPE_LABELS) as HeaderScope[]).map((scope) => (
          <option key={scope} value={scope}>
            {SCOPE_LABELS[scope]}
          </option>
        ))}
      </select>
      <p className="jf-field__hint">{SCOPE_HINTS[value]}</p>
    </div>
  );
}

/** The exact response headers a request in this scope will carry. */
export function HeaderPreview({ headers }: { headers: ResolvedHeader[] }) {
  if (headers.length === 0) {
    return <p className="jf-field__hint">No security headers are sent for these requests.</p>;
  }
  return (
    <div className="jf-log">
      {headers.map((h) => (
        <div key={h.name} className="jf-log__line jf-log__line--ok">
          <span className="jf-log__label">{h.name}:</span> {h.value}
        </div>
      ))}
    </div>
  );
}

/** Sticky-feeling action row shared by every editing screen in this section. */
export function SaveBar({
  dirty,
  saving,
  saved,
  error,
  onSave,
  onDiscard,
  children,
}: {
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
  onSave: () => void;
  onDiscard: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="jf-row">
      <button className="jf-btn jf-btn--primary" onClick={onSave} disabled={saving || !dirty}>
        {saving ? "Saving…" : "Save changes"}
      </button>
      <button className="jf-btn jf-btn--ghost" onClick={onDiscard} disabled={saving || !dirty}>
        Discard
      </button>
      {children}
      {dirty && !saving && <span className="jf-status jf-status--dirty">Unsaved changes</span>}
      {saved && <span className="jf-status jf-status--saved">✓ Saved — now live</span>}
      {error && <span className="jf-status jf-status--error">{error}</span>}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="jf-page" aria-busy="true">
      <div className="jf-skeleton" style={{ height: 44, maxWidth: 280 }} />
      <div className="jf-skeleton" style={{ height: 120 }} />
      <div className="jf-skeleton" style={{ height: 320 }} />
    </div>
  );
}

export function LoadError({ error }: { error: string }) {
  return (
    <div className="jf-page">
      <div className="jf-banner jf-banner--error">
        <span className="jf-banner__icon" aria-hidden="true">
          ⚠
        </span>
        <div>
          <div className="jf-banner__title">Could not load the security settings</div>
          <div className="jf-banner__sub">{error}</div>
        </div>
      </div>
    </div>
  );
}

/** Shown on every screen while the environment override is in force. */
export function KillSwitchNotice() {
  return (
    <div className="jf-banner jf-banner--warn">
      <span className="jf-banner__icon" aria-hidden="true">
        ⚠
      </span>
      <div>
        <div className="jf-banner__title">Custom headers are overridden right now</div>
        <div className="jf-banner__sub">
          <code>JF_SECURITY_HEADERS_DISABLED</code> is set in the environment, so the site is sending
          the built-in defaults instead of the configuration below. Remove it and restart to take
          this screen live again.
        </div>
      </div>
    </div>
  );
}
