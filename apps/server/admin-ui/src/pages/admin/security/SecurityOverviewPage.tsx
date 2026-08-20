import { useState } from "react";
import { Link } from "react-router-dom";
import { useSecurityConfig } from "./useSecurityConfig";
import {
  GradeBadge,
  HeaderPreview,
  KillSwitchNotice,
  LevelBadge,
  LoadError,
  PageSkeleton,
  SaveBar,
  Section,
} from "./components";
import type { FindingLevel } from "./types";

const PREVIEW_TABS = [
  { key: "publicSecure", label: "Public site (HTTPS)" },
  { key: "publicInsecure", label: "Public site (HTTP)" },
  { key: "admin", label: "Admin & API" },
] as const;

/** Issues first, then the things already handled. */
const LEVEL_ORDER: FindingLevel[] = ["critical", "warning", "info", "pass"];

export default function SecurityOverviewPage() {
  const state = useSecurityConfig();
  const [tab, setTab] = useState<(typeof PREVIEW_TABS)[number]["key"]>("publicSecure");

  if (state.loading) return <PageSkeleton />;
  if (!state.payload || !state.draft || !state.audit) {
    return <LoadError error={state.error ?? "Unknown error"} />;
  }

  const { audit, effective, payload } = state;
  const open = audit.findings.filter((f) => f.level !== "pass");
  const passes = audit.findings.filter((f) => f.level === "pass");
  const ordered = [...open, ...passes].sort(
    (a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level),
  );

  const alreadyRecommended =
    JSON.stringify(state.draft) === JSON.stringify(payload.recommended);

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>Security</h1>
          <p>What your site tells visitors' browsers to enforce, and what is still missing.</p>
        </div>
        <div className="jf-pagehead__actions">
          <GradeBadge audit={audit} live={state.dirty} />
        </div>
      </header>

      {payload.killSwitch && <KillSwitchNotice />}

      <div
        className={
          audit.counts.critical > 0
            ? "jf-banner jf-banner--error"
            : audit.counts.warning > 0
              ? "jf-banner jf-banner--warn"
              : "jf-banner jf-banner--ok"
        }
      >
        <span className="jf-banner__icon" aria-hidden="true">
          {audit.counts.critical > 0 ? "⚠" : audit.counts.warning > 0 ? "!" : "✓"}
        </span>
        <div>
          <div className="jf-banner__title">
            Grade {audit.grade} — {audit.score} out of 100
          </div>
          <div className="jf-banner__sub">
            {audit.counts.critical} critical, {audit.counts.warning} warnings,{" "}
            {audit.counts.info} suggestions, {audit.counts.pass} protections in place.
            {state.dirty && " Based on your unsaved changes."}
          </div>
        </div>
      </div>

      <Section
        title="Recommended configuration"
        action={
          <button
            className="jf-btn jf-btn--primary"
            onClick={() => state.replaceDraft(payload.recommended)}
            disabled={alreadyRecommended || state.saving}
          >
            {alreadyRecommended ? "Already applied" : "Apply recommended"}
          </button>
        }
      >
        <p className="jf-field__hint">
          Turns on every header we consider a baseline for a public site, with the Content Security
          Policy in report-only mode so nothing breaks while you check the reports. Review the result
          below and save when you are happy with it — nothing changes until you do.
        </p>
        <div className="jf-row">
          <Link className="jf-btn jf-btn--ghost" to="/admin/security/headers">
            Edit each header
          </Link>
          <Link className="jf-btn jf-btn--ghost" to="/admin/security/advanced">
            Custom headers &amp; import
          </Link>
        </div>
      </Section>

      <Section title={`Findings (${open.length} open)`}>
        <div className="jf-list">
          {ordered.map((finding) => (
            <div key={finding.id} className="jf-list__row">
              <div className="jf-list__main">
                <div className="jf-list__title">
                  <LevelBadge level={finding.level} /> {finding.title}
                </div>
                <div className="jf-list__desc">{finding.detail}</div>
              </div>
              {finding.headerId && (
                <Link
                  className="jf-btn jf-btn--quiet"
                  to={`/admin/security/headers#${finding.headerId}`}
                >
                  {finding.level === "pass" ? "Review" : "Fix"}
                </Link>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Headers being sent">
        <div className="jf-tabs" role="tablist">
          {PREVIEW_TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              className="jf-tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {effective && <HeaderPreview headers={effective[tab]} />}
        <p className="jf-field__hint">
          Exactly what a browser receives, worked out from the configuration currently on screen.
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
