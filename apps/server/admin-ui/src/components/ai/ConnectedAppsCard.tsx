import { useEffect, useState } from "react";
import { useT } from "../../i18n/I18nProvider";
import { aiJson, type ConnectedApp } from "../../lib/ai-api";

/**
 * AI apps connected through OAuth (claude.ai, ChatGPT, …). `all` lists every
 * grant on the site (Settings → API, administrators); otherwise only the
 * signed-in user's own. Revoking cuts the app off on its next request.
 */
export default function ConnectedAppsCard({ all }: { all: boolean }) {
  const { t } = useT();
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const result = await aiJson<{ grants: ConnectedApp[] }>(`/api/oauth/grants${all ? "?all=1" : ""}`, undefined, t("common.requestFailed"));
    setApps(Array.isArray(result?.grants) ? result.grants : []);
  }

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);

  async function revoke(app: ConnectedApp) {
    if (!confirm(t("ai.apps.revokeConfirm", { name: app.clientName }))) return;
    try {
      await aiJson(`/api/oauth/grants/${encodeURIComponent(app.id)}`, { method: "DELETE" }, t("common.requestFailed"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    }
  }

  return (
    <section className="jf-card">
      <div className="jf-card__head">
        <h2 className="jf-card__title">{t("ai.apps.title")}</h2>
      </div>
      {error && (
        <div className="jf-card__body">
          <div className="jf-alert jf-alert--error" role="alert">
            {error}
          </div>
        </div>
      )}
      <div className="jf-card__body--flush jf-tablewrap">
        <table className="jf-table">
          <thead>
            <tr>
              <th>{t("ai.apps.app")}</th>
              {all && <th>{t("ai.apps.user")}</th>}
              <th>{t("ai.apps.permissions")}</th>
              <th>{t("ai.apps.connected")}</th>
              <th>{t("ai.apps.lastUsed")}</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {apps === null ? (
              <tr>
                <td colSpan={all ? 6 : 5}>{t("common.loading")}</td>
              </tr>
            ) : apps.length === 0 ? (
              <tr>
                <td colSpan={all ? 6 : 5}>{t("ai.apps.empty")}</td>
              </tr>
            ) : (
              apps.map((app) => (
                <tr key={app.id}>
                  <td className="jf-td--strong">{app.clientName}</td>
                  {all && <td>{app.userName || app.userEmail || app.userId}</td>}
                  <td title={app.capabilities.join(", ")}>
                    {t("ai.apps.permissionCount", { count: app.capabilities.length })}
                    {app.userTools ? ` · ${t("ai.apps.userTools")}` : ""}
                  </td>
                  <td className="jf-td--muted">{new Date(app.createdAt).toLocaleString()}</td>
                  <td className="jf-td--muted">{app.lastUsedAt ? new Date(app.lastUsedAt).toLocaleString() : t("ai.apps.never")}</td>
                  <td className="jf-td--actions">
                    <button className="jf-btn jf-btn--danger jf-btn--sm" type="button" onClick={() => void revoke(app)}>
                      {t("ai.apps.revoke")}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
