import { useCallback, useEffect, useState } from "react";
import { Link } from "../../../admin-router";
import { initialJson } from "../../../ssr-data";
import { useT } from "../../../i18n/I18nProvider";
import { PageSkeleton } from "./components";
import { securityCenterCopy } from "./security-center-copy";

type CheckStatus = "pass" | "warn" | "fail" | "unknown" | "not_applicable";
type CheckKind = "configuration" | "deployment";
type CheckScope = "site" | "installation";

interface SecurityCheck {
  id: string;
  status: CheckStatus;
  severity: "critical" | "high" | "medium" | "low" | "info";
  kind: CheckKind;
  scope: CheckScope;
  summary: string;
  checkedAt: string;
  href: string | null;
  evidence: Record<string, string | number>;
}

interface SecurityCenterReport {
  checkedAt: string;
  installationRoot: boolean;
  auditAvailable: boolean;
  checks: SecurityCheck[];
}

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];

const STATUS_TONE: Record<CheckStatus, string> = {
  pass: "jf-badge--ok",
  warn: "jf-badge--warn",
  fail: "jf-badge--error",
  unknown: "jf-badge--info",
  not_applicable: "",
};

const GROUP_KEY: Record<CheckStatus, string> = {
  fail: "security.center.groups.attention",
  warn: "security.center.groups.attention",
  unknown: "security.center.groups.unknown",
  pass: "security.center.groups.pass",
  not_applicable: "security.center.groups.notApplicable",
};

function adminHref(href: string | null): string | null {
  if (!href || !href.startsWith("/admin/") || href.includes("://") || href.includes("\\")) return null;
  return href;
}

function formatChecked(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function SecurityCenterPage() {
  const { t } = useT();
  const prefetched = initialJson<SecurityCenterReport>("/api/security/center");
  const [report, setReport] = useState<SecurityCenterReport | null>(prefetched ?? null);
  const [loading, setLoading] = useState(!prefetched);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/security/center");
      const data = (await res.json().catch(() => ({}))) as SecurityCenterReport & { error?: string };
      if (!res.ok) throw new Error(data.error ?? t("security.center.loadError"));
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("security.center.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (prefetched) return;
    void load();
  }, [load, prefetched]);

  if (loading && !report) return <PageSkeleton />;

  const checks = report?.checks ?? [];
  const counts = {
    fail: checks.filter((check) => check.status === "fail").length,
    warn: checks.filter((check) => check.status === "warn").length,
    unknown: checks.filter((check) => check.status === "unknown").length,
    pass: checks.filter((check) => check.status === "pass").length,
  };
  const attention = checks
    .filter((check) => check.status === "fail" || check.status === "warn")
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const later = (["unknown", "pass", "not_applicable"] as const)
    .map((status) => ({ status, checks: checks.filter((check) => check.status === status) }))
    .filter((group) => group.checks.length > 0);

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("security.center.title")}</h1>
          <p>{t("security.center.subtitle")}</p>
        </div>
        <div className="jf-pagehead__actions">
          <button className="jf-btn" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? t("security.center.checking") : t("security.center.checkAgain")}
          </button>
        </div>
      </header>

      {error && (
        <div className="jf-banner jf-banner--error" role="alert">
          <span className="jf-banner__icon" aria-hidden="true">
            ⚠
          </span>
          <div>
            <div className="jf-banner__title">{t("security.center.loadError")}</div>
            <div className="jf-banner__sub">{error}</div>
          </div>
        </div>
      )}

      {report && (
        <div
          className={
            counts.fail > 0 ? "jf-banner jf-banner--error" : counts.warn > 0 ? "jf-banner jf-banner--warn" : "jf-banner jf-banner--ok"
          }
        >
          <span className="jf-banner__icon" aria-hidden="true">
            {counts.fail > 0 ? "⚠" : counts.warn > 0 ? "!" : "✓"}
          </span>
          <div>
            <div className="jf-banner__title">
              {t("security.center.banner", counts)}
            </div>
            <div className="jf-banner__sub">{t("security.center.checked", { time: formatChecked(report.checkedAt) })}</div>
          </div>
        </div>
      )}

      {report?.auditAvailable && (
        <p>
          <Link to="/admin/security/audit">{t("security.center.events")}</Link>
          {" · "}
          {t("security.center.eventsHint")}
        </p>
      )}

      {report && checks.length === 0 && <p>{t("security.center.empty")}</p>}

      {attention.length > 0 && (
        <CheckGroup title={t("security.center.groups.attention")} checks={attention} />
      )}
      {later.map((group) => (
        <CheckGroup key={group.status} title={t(GROUP_KEY[group.status])} checks={group.checks} />
      ))}
    </div>
  );
}

function CheckGroup({ title, checks }: { title: string; checks: SecurityCheck[] }) {
  const { t } = useT();
  if (checks.length === 0) return null;
  return (
    <section className="jf-card">
      <div className="jf-card__head">
        <h2 className="jf-card__title">{title}</h2>
      </div>
      <div className="jf-card__body">
        <div className="jf-list">
          {checks.map((check) => {
            const copy = securityCenterCopy(check.id, check.summary);
            const href = adminHref(check.href);
            const showAction = check.status !== "pass";
            return (
              <div key={check.id} className="jf-list__row">
                <div className="jf-list__main">
                  <div className="jf-list__title">
                    <span className={`jf-badge ${STATUS_TONE[check.status]}`.trim()}>
                      {t(`security.center.status.${check.status}`)}
                    </span>{" "}
                    {t(checkTitle(check.id))}
                  </div>
                  <div className="jf-list__desc">{t(copy.detail, check.evidence)}</div>
                  <div className="jf-list__desc">
                    {t(`security.center.kind.${check.kind}`)}
                    {" · "}
                    {t(`security.center.scope.${check.scope}`)}
                    {" · "}
                    {t("security.center.checked", { time: formatChecked(check.checkedAt) })}
                  </div>
                  {showAction && <div className="jf-list__desc">{t(copy.remediation, check.evidence)}</div>}
                </div>
                {href && (
                  <Link className="jf-btn jf-btn--quiet" to={href}>
                    {t("security.center.open")}
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function checkTitle(id: string): string {
  switch (id) {
    case "runtime.node":
      return "security.center.checks.runtimeNode.title";
    case "runtime.update":
      return "security.center.checks.runtimeUpdate.title";
    case "runtime.debug":
      return "security.center.checks.runtimeDebug.title";
    case "runtime.installer":
      return "security.center.checks.runtimeInstaller.title";
    case "accounts.mfa":
      return "security.center.checks.accountsMfa.title";
    case "accounts.sessions":
      return "security.center.checks.accountsSessions.title";
    case "accounts.apiKeys":
      return "security.center.checks.accountsApiKeys.title";
    case "transport.cookies":
      return "security.center.checks.transportCookies.title";
    case "transport.tls":
      return "security.center.checks.transportTls.title";
    case "transport.proxy":
      return "security.center.checks.transportProxy.title";
    case "headers.policy":
      return "security.center.checks.headersPolicy.title";
    case "extensions.integrity":
      return "security.center.checks.extensionsIntegrity.title";
    case "recovery.backup":
      return "security.center.checks.recoveryBackup.title";
    default:
      return "security.center.missing";
  }
}
