import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Section } from "./components";
import { useT } from "../../../i18n/I18nProvider";

type Entry = { id: string; occurredAt: string; action: string; outcome: string; actorEmail: string | null; actorRole: string | null; target: string | null; ip: string | null; detail: string | null };
type AuditView = "all" | "security";
type Payload = { entries: Entry[]; actions: string[]; view: AuditView };

/** Site-scoped audit entries and event filters. */
export default function AuditLogPage() {
  const { t } = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const view: AuditView = searchParams.get("view") === "security" ? "security" : "all";
  const load = useCallback(async (selectedView: AuditView, action: string) => {
    try {
      const params = new URLSearchParams({ view: selectedView });
      if (action) params.set("action", action);
      const res = await fetch(`/api/audit?${params.toString()}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      setData(await res.json() as Payload); setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, []);
  useEffect(() => { void load(view, filter); }, [load, filter, view]);
  const changeView = (next: AuditView) => { setFilter(""); setSearchParams(next === "security" ? { view: "security" } : {}); };
  return <div className="jf-page">
    <header className="jf-pagehead"><div className="jf-pagehead__text"><h1>{t("security.audit.title")}</h1><p>{t("security.audit.subtitle")}</p></div><div className="jf-pagehead__actions"><Link className="jf-btn" to="/admin/security/audit/settings">{t("security.audit.settingsButton")}</Link></div></header>
    <Section title={t("security.audit.recent.title")} action={<div className="jf-row"><select className="jf-input" value={view} onChange={(event) => changeView(event.target.value as AuditView)} aria-label={t("security.audit.viewLabel")}><option value="security">{t("security.audit.securityEvents")}</option><option value="all">{t("security.audit.allEvents")}</option></select><select className="jf-input" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label={t("security.audit.filterLabel")}><option value="">{t("security.audit.allActions")}</option>{(data?.actions ?? []).map((action) => <option key={action} value={action}>{action}</option>)}</select></div>}>
      {error ? <p className="jf-status jf-status--error">{error}</p> : null}
      {!data ? <p className="jf-skeleton" /> : data.entries.length === 0 ? <p>{t("security.audit.empty")}</p> : <div className="jf-tablewrap"><table className="jf-table"><thead><tr><th>{t("security.audit.table.when")}</th><th>{t("security.audit.table.action")}</th><th>{t("security.audit.table.who")}</th><th>{t("security.audit.table.target")}</th><th>{t("security.audit.table.from")}</th></tr></thead><tbody>{data.entries.map((entry) => <tr key={entry.id}><td className="jf-td--muted">{entry.occurredAt}</td><td className="jf-td--strong">{entry.action}{entry.outcome !== "success" ? <span className="jf-badge jf-badge--error"> {entry.outcome}</span> : null}{entry.detail ? <div className="jf-td--muted">{entry.detail}</div> : null}</td><td>{entry.actorEmail ?? "—"}{entry.actorRole ? <div className="jf-td--muted">{entry.actorRole}</div> : null}</td><td className="jf-td--muted">{entry.target ?? "—"}</td><td className="jf-td--muted">{entry.ip ?? "—"}</td></tr>)}</tbody></table></div>}
    </Section>
  </div>;
}
