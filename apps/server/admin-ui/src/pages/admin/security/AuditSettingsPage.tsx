import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Section } from "./components";
import { useT } from "../../../i18n/I18nProvider";

type NotificationStatus = { enabled: boolean; available: boolean; recipient: string; canManageNetwork: boolean; networkEnabled: boolean };
type AuditSettings = { retentionDays: number; writeStatus: { available: boolean; lastFailureAt: string | null; maxRowsPerSite: number } };

/** Notification, retention, export, and deletion controls for the audit trail. */
export default function AuditSettingsPage() {
  const { t } = useT();
  const [settings, setSettings] = useState<AuditSettings | null>(null);
  const [notifications, setNotifications] = useState<NotificationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [auditRes, notificationRes] = await Promise.all([fetch("/api/audit?view=security&limit=1"), fetch("/api/audit/notifications")]);
      if (!auditRes.ok || !notificationRes.ok) throw new Error(t("security.audit.settingsLoadError"));
      setSettings(await auditRes.json() as AuditSettings); setNotifications(await notificationRes.json() as NotificationStatus); setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  const saveNotifications = async (patch: Partial<Pick<NotificationStatus, "enabled" | "networkEnabled">>) => {
    setBusy(true); setError(null);
    try { const res = await fetch("/api/audit/notifications", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: notifications?.enabled ?? false, networkEnabled: notifications?.networkEnabled ?? false, ...patch }) }); if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`); setNotifications(await res.json() as NotificationStatus); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };
  const prune = async () => { setBusy(true); await fetch("/api/audit/prune", { method: "POST" }).catch(() => null); await load(); setBusy(false); };
  const exportEvents = async () => { const res = await fetch("/api/audit/security-export"); if (!res.ok) { setError(t("security.audit.settingsLoadError")); return; } const url = URL.createObjectURL(await res.blob()); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "justflows-security-events.json"; anchor.click(); URL.revokeObjectURL(url); };
  const deleteEvents = async () => { setBusy(true); setMessage(null); const res = await fetch("/api/audit/security-events", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation }) }); const body = await res.json().catch(() => ({})) as { error?: string; removed?: number }; if (res.ok) { setConfirmation(""); setMessage(t("security.audit.lifecycle.deleted", { count: body.removed ?? 0 })); } else setError(body.error ?? `HTTP ${res.status}`); setBusy(false); };
  return <div className="jf-page">
    <header className="jf-pagehead"><div className="jf-pagehead__text"><h1>{t("security.audit.settingsTitle")}</h1><p>{t("security.audit.settingsSubtitle")}</p></div><div className="jf-pagehead__actions"><Link className="jf-btn" to="/admin/security/audit?view=security">{t("security.audit.backToEvents")}</Link></div></header>
    {error ? <p className="jf-status jf-status--error">{error}</p> : null}
    <Section title={t("security.audit.notifications.title")}><p>{t("security.audit.notifications.description")}</p>{!notifications ? <p className="jf-skeleton" /> : <><label className="jf-toggle"><input type="checkbox" checked={notifications.enabled} disabled={!notifications.available || busy} onChange={(event) => void saveNotifications({ enabled: event.target.checked })} /><span>{t("security.audit.notifications.enable")}<small>{notifications.available ? t("security.audit.notifications.recipient", { email: notifications.recipient }) : t("security.audit.notifications.unavailable")}</small></span></label>{notifications.canManageNetwork ? <label className="jf-toggle"><input type="checkbox" checked={notifications.networkEnabled} disabled={!notifications.available || busy} onChange={(event) => void saveNotifications({ networkEnabled: event.target.checked })} /><span>{t("security.audit.notifications.networkEnable")}<small>{t("security.audit.notifications.networkHint")}</small></span></label> : null}</>}<p className="jf-field__hint">{t("security.audit.notifications.limit")}</p></Section>
    <Section title={t("security.audit.retention.title")}>
      {!settings ? <p className="jf-skeleton" /> : <><p className={`jf-status ${settings.writeStatus.available ? "" : "jf-status--error"}`}>{settings.writeStatus.available ? t("security.audit.lifecycle.writeOk") : t("security.audit.lifecycle.writeFailed", { time: settings.writeStatus.lastFailureAt ?? "—" })}</p><p>{t("security.audit.retention.windowPrefix", { days: settings.retentionDays })} <code className="jf-code">JF_AUDIT_RETENTION_DAYS</code> {t("security.audit.retention.windowSuffix")}</p><p><strong>{t("security.audit.retention.applyButtonLabel")}</strong> {t("security.audit.retention.applyExplain")}</p><button className="jf-btn" type="button" onClick={() => void prune()} disabled={busy}>{busy ? t("security.audit.retention.removing") : t("security.audit.retention.applyButtonLabel")}</button><p>{t("security.audit.lifecycle.bound", { count: settings.writeStatus.maxRowsPerSite })}</p></>}
      <p>{t("security.audit.lifecycle.localWarning")}</p>{message ? <p className="jf-status">{message}</p> : null}<div className="jf-row"><button className="jf-btn" type="button" onClick={() => void exportEvents()}>{t("security.audit.lifecycle.exportButton")}</button></div><label className="jf-field"><span>{t("security.audit.lifecycle.confirmLabel")}</span><input className="jf-input" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={t("security.audit.confirmPhrase")} /></label><button className="jf-btn jf-btn--danger" type="button" disabled={busy || confirmation !== "DELETE SECURITY EVENTS"} onClick={() => void deleteEvents()}>{t("security.audit.lifecycle.deleteButton")}</button>
    </Section>
  </div>;
}
