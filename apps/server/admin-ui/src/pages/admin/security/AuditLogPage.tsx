import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Section } from "./components";
import { useT } from "../../../i18n/I18nProvider";

type Entry = {
  id: string;
  occurredAt: string;
  action: string;
  outcome: string;
  actorEmail: string | null;
  actorRole: string | null;
  target: string | null;
  ip: string | null;
  detail: string | null;
};

type AuditView = "all" | "security";
type Payload = { entries: Entry[]; actions: string[]; retentionDays: number; view: AuditView };

/**
 * The administrative audit trail.
 *
 * Answers the question asked in the hour after something goes wrong: who did
 * this, from where, and when. Nothing recorded it before.
 */
export default function AuditLogPage() {
  const { t } = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const view: AuditView = searchParams.get("view") === "security" ? "security" : "all";

  const load = useCallback(async (selectedView: AuditView, action: string) => {
    try {
      const params = new URLSearchParams({ view: selectedView });
      if (action) params.set("action", action);
      const res = await fetch(`/api/audit?${params.toString()}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      setData((await res.json()) as Payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load(view, filter);
  }, [load, filter, view]);

  const changeView = (next: AuditView) => {
    setFilter("");
    setSearchParams(next === "security" ? { view: "security" } : {});
  };

  const prune = async () => {
    setBusy(true);
    await fetch("/api/audit/prune", { method: "POST" }).catch(() => null);
    setBusy(false);
    void load(view, filter);
  };

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("security.audit.title")}</h1>
          <p>{t("security.audit.subtitle")}</p>
        </div>
      </header>

      <Section
        title={t("security.audit.recent.title")}
        action={
          <div className="jf-row">
            <select
              className="jf-input"
              value={view}
              onChange={(e) => changeView(e.target.value as AuditView)}
              aria-label={t("security.audit.viewLabel")}
            >
              <option value="security">{t("security.audit.securityEvents")}</option>
              <option value="all">{t("security.audit.allEvents")}</option>
            </select>
            <select
              className="jf-input"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label={t("security.audit.filterLabel")}
            >
              <option value="">{t("security.audit.allActions")}</option>
              {(data?.actions ?? []).map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {error ? <p className="jf-status jf-status--error">{error}</p> : null}

        {!data ? (
          <p className="jf-skeleton" />
        ) : data.entries.length === 0 ? (
          <p>{t("security.audit.empty")}</p>
        ) : (
          <div className="jf-tablewrap">
            <table className="jf-table">
              <thead>
                <tr>
                  <th>{t("security.audit.table.when")}</th>
                  <th>{t("security.audit.table.action")}</th>
                  <th>{t("security.audit.table.who")}</th>
                  <th>{t("security.audit.table.target")}</th>
                  <th>{t("security.audit.table.from")}</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="jf-td--muted">{e.occurredAt}</td>
                    <td className="jf-td--strong">
                      {e.action}
                      {e.outcome !== "success" ? (
                        <span className="jf-badge jf-badge--error"> {e.outcome}</span>
                      ) : null}
                      {e.detail ? <div className="jf-td--muted">{e.detail}</div> : null}
                    </td>
                    <td>
                      {e.actorEmail ?? "—"}
                      {e.actorRole ? <div className="jf-td--muted">{e.actorRole}</div> : null}
                    </td>
                    <td className="jf-td--muted">{e.target ?? "—"}</td>
                    <td className="jf-td--muted">{e.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={t("security.audit.retention.title")}>
        <p>
          {t("security.audit.retention.windowPrefix", { days: data?.retentionDays ?? 365 })}{" "}
          <code className="jf-code">JF_AUDIT_RETENTION_DAYS</code>{" "}
          {t("security.audit.retention.windowSuffix")}
        </p>
        <p>
          <strong>{t("security.audit.retention.applyButtonLabel")}</strong>{" "}
          {t("security.audit.retention.applyExplain")}
        </p>
        <div className="jf-row">
          <button className="jf-btn" type="button" onClick={prune} disabled={busy}>
            {busy ? t("security.audit.retention.removing") : t("security.audit.retention.applyButtonLabel")}
          </button>
        </div>
      </Section>
    </div>
  );
}
