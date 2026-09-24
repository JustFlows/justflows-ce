import type { ReactNode } from "react";
import {
  SCOPE_HINTS,
  SCOPE_LABELS,
  type FindingLevel,
  type HeaderScope,
  type ResolvedHeader,
  type SecurityAudit,
} from "./types";
import { useT } from "../../../i18n/I18nProvider";

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

const LEVEL_LABEL_KEY: Record<FindingLevel, string> = {
  critical: "security.shared.findingLevel.critical",
  warning: "security.shared.findingLevel.warning",
  info: "security.shared.findingLevel.info",
  pass: "security.shared.findingLevel.pass",
};

export function GradeBadge({ audit, live }: { audit: SecurityAudit; live?: boolean }) {
  const { t } = useT();
  return (
    <span
      className={`jf-badge ${GRADE_TONE[audit.grade]}`}
      title={t("security.shared.gradeBadge.title", { score: audit.score })}
    >
      {t("security.shared.gradeBadge.label", { grade: audit.grade, score: audit.score })}
      {live ? ` ${t("security.shared.gradeBadge.unsavedSuffix")}` : ""}
    </span>
  );
}

export function LevelBadge({ level }: { level: FindingLevel }) {
  const { t } = useT();
  return (
    <span className={`jf-badge ${LEVEL_TONE[level]}`}>
      {LEVEL_ICON[level]} {t(LEVEL_LABEL_KEY[level])}
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
  const { t } = useT();
  return (
    <div className="jf-field">
      <label className="jf-field__label" htmlFor={id}>
        {t("security.shared.scopeSelect.label")}
      </label>
      <select
        id={id}
        className="jf-input"
        value={value}
        onChange={(e) => onChange(e.target.value as HeaderScope)}
      >
        {(Object.keys(SCOPE_LABELS) as HeaderScope[]).map((scope) => (
          <option key={scope} value={scope}>
            {t(SCOPE_LABELS[scope])}
          </option>
        ))}
      </select>
      <p className="jf-field__hint">{t(SCOPE_HINTS[value])}</p>
    </div>
  );
}

/** The exact response headers a request in this scope will carry. */
export function HeaderPreview({ headers }: { headers: ResolvedHeader[] }) {
  const { t } = useT();
  if (headers.length === 0) {
    return <p className="jf-field__hint">{t("security.shared.headerPreview.empty")}</p>;
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
  const { t } = useT();
  return (
    <div className="jf-row">
      <button className="jf-btn jf-btn--primary" onClick={onSave} disabled={saving || !dirty}>
        {saving ? t("common.saving") : t("security.shared.saveBar.save")}
      </button>
      <button className="jf-btn jf-btn--ghost" onClick={onDiscard} disabled={saving || !dirty}>
        {t("security.shared.saveBar.discard")}
      </button>
      {children}
      {dirty && !saving && <span className="jf-status jf-status--dirty">{t("security.shared.saveBar.unsaved")}</span>}
      {saved && <span className="jf-status jf-status--saved">{t("security.shared.saveBar.saved")}</span>}
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
  const { t } = useT();
  return (
    <div className="jf-page">
      <div className="jf-banner jf-banner--error">
        <span className="jf-banner__icon" aria-hidden="true">
          ⚠
        </span>
        <div>
          <div className="jf-banner__title">{t("security.shared.loadError.title")}</div>
          <div className="jf-banner__sub">{error}</div>
        </div>
      </div>
    </div>
  );
}

/** Shown on every screen while the environment override is in force. */
export function KillSwitchNotice() {
  const { t } = useT();
  return (
    <div className="jf-banner jf-banner--warn">
      <span className="jf-banner__icon" aria-hidden="true">
        ⚠
      </span>
      <div>
        <div className="jf-banner__title">{t("security.shared.killSwitch.title")}</div>
        <div className="jf-banner__sub">
          <code>JF_SECURITY_HEADERS_DISABLED</code> {t("security.shared.killSwitch.body")}
        </div>
      </div>
    </div>
  );
}
