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
type NotificationStatus = {
  enabled: boolean;
  available: boolean;
  recipient: string;
  canManageNetwork: boolean;
  networkEnabled: boolean;
};

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
  const [notifications, setNotifications] = useState<NotificationStatus | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [notificationBusy, setNotificationBusy] = useState(false);
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

  useEffect(() => {
    fetch("/api/audit/notifications")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
        setNotifications(await res.json() as NotificationStatus);
      })
      .catch((err) => setNotificationError(err instanceof Error ? err.message : String(err)));
  }, []);

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

  const saveNotifications = async (patch: Partial<Pick<NotificationStatus, "enabled" | "networkEnabled">>) => {
    setNotificationBusy(true);
    setNotificationError(null);
    try {
      const res = await fetch("/api/audit/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: notifications?.enabled ?? false,
          networkEnabled: notifications?.networkEnabled ?? false,
          ...patch,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      setNotifications(await res.json() as NotificationStatus);
    } catch (err) {
      setNotificationError(err instanceof Error ? err.message : String(err));
    } finally {
      setNotificationBusy(false);
    }
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

      <Section title={t("security.audit.notifications.title")}>
        <p>{t("security.audit.notifications.description")}</p>
        {notificationError ? <p className="jf-status jf-status--error">{notificationError}</p> : null}
        {!notifications ? (
          <p className="jf-skeleton" />
        ) : (
          <label className="jf-toggle">
            <input
              type="checkbox"
              checked={notifications.enabled}
              disabled={!notifications.available || notificationBusy}
              onChange={(event) => void saveNotifications({ enabled: event.target.checked })}
            />
            <span>
              {t("security.audit.notifications.enable")}
              <small>
                {notifications.available
                  ? t("security.audit.notifications.recipient", { email: notifications.recipient })
                  : t("security.audit.notifications.unavailable")}
              </small>
            </span>
          </label>
        )}
        {notifications?.canManageNetwork ? (
          <label className="jf-toggle">
            <input
              type="checkbox"
              checked={notifications.networkEnabled}
              disabled={!notifications.available || notificationBusy}
              onChange={(event) => void saveNotifications({ networkEnabled: event.target.checked })}
            />
            <span>
              {t("security.audit.notifications.networkEnable")}
              <small>{t("security.audit.notifications.networkHint")}</small>
            </span>
          </label>
        ) : null}
        <p className="jf-field__hint">{t("security.audit.notifications.limit")}</p>
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
