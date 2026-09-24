import { useState } from "react";
import { Link } from "../../../admin-router";
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
import { useT } from "../../../i18n/I18nProvider";

const PREVIEW_TAB_KEYS = {
  publicSecure: "security.overview.tabs.publicSecure",
  publicInsecure: "security.overview.tabs.publicInsecure",
  admin: "security.overview.tabs.admin",
} as const;

const PREVIEW_TABS = [
  { key: "publicSecure" },
  { key: "publicInsecure" },
  { key: "admin" },
] as const;

/** Issues first, then the things already handled. */
const LEVEL_ORDER: FindingLevel[] = ["critical", "warning", "info", "pass"];

export default function SecurityOverviewPage() {
  const { t } = useT();
  const state = useSecurityConfig();
  const [tab, setTab] = useState<(typeof PREVIEW_TABS)[number]["key"]>("publicSecure");

  if (state.loading) return <PageSkeleton />;
  if (!state.payload || !state.draft || !state.audit) {
    return <LoadError error={state.error ?? t("security.shared.unknownError")} />;
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
          <h1>{t("security.overview.title")}</h1>
          <p>{t("security.overview.subtitle")}</p>
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
            {t("security.overview.banner.grade", { grade: audit.grade, score: audit.score })}
          </div>
          <div className="jf-banner__sub">
            {t("security.overview.banner.summary", {
              critical: audit.counts.critical,
              warning: audit.counts.warning,
              info: audit.counts.info,
              pass: audit.counts.pass,
            })}
            {state.dirty && ` ${t("security.overview.banner.unsavedNote")}`}
          </div>
        </div>
      </div>

      <Section
        title={t("security.overview.recommended.title")}
        action={
          <button
            className="jf-btn jf-btn--primary"
            onClick={() => state.replaceDraft(payload.recommended)}
            disabled={alreadyRecommended || state.saving}
          >
            {alreadyRecommended
              ? t("security.overview.recommended.alreadyApplied")
              : t("security.overview.recommended.apply")}
          </button>
        }
      >
        <p className="jf-field__hint">
          {t("security.overview.recommended.body")}
        </p>
        <div className="jf-row">
          <Link className="jf-btn jf-btn--ghost" to="/admin/security/headers">
            {t("security.overview.recommended.editHeaders")}
          </Link>
          <Link className="jf-btn jf-btn--ghost" to="/admin/security/advanced">
            {t("security.overview.recommended.customHeaders")}
          </Link>
        </div>
      </Section>

      <Section title={t("security.overview.findings.title", { count: open.length })}>
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
                  {finding.level === "pass"
                    ? t("security.overview.findings.review")
                    : t("security.overview.findings.fix")}
                </Link>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title={t("security.overview.headersSent.title")}>
        <div className="jf-tabs" role="tablist">
          {PREVIEW_TABS.map((tabDef) => (
            <button
              key={tabDef.key}
              role="tab"
              className="jf-tab"
              aria-selected={tab === tabDef.key}
              onClick={() => setTab(tabDef.key)}
            >
              {t(PREVIEW_TAB_KEYS[tabDef.key])}
            </button>
          ))}
        </div>
        {effective && <HeaderPreview headers={effective[tab]} />}
        <p className="jf-field__hint">
          {t("security.overview.headersSent.hint")}
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
