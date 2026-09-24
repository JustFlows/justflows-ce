import { useEffect, useState } from "react";
import { Link } from "../../../admin-router";
import { useT } from "../../../i18n/I18nProvider";

interface AnalyticsSummary {
  collecting: boolean;
  enabled: boolean;
  totals: { views: number };
  daily: Array<{ day: string; count: number }>;
  pages: Array<{ path: string; count: number }>;
  referrers: Array<{ referrer: string; count: number }>;
  devices: Array<{ device: string; count: number }>;
}

export default function AnalyticsPage() {
  const { t } = useT();
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    fetch("/api/analytics")
      .then((r) => r.json())
      .then((body: AnalyticsSummary & { error?: string }) => {
        if (body.error) throw new Error(body.error);
        setData(body);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const maxDaily = Math.max(1, ...(data?.daily.map((row) => row.count) ?? [1]));

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("analytics.title")}</h1>
          <p>{t("analytics.subtitle")}</p>
        </div>
        <Link className="jf-btn jf-btn--ghost" to="/admin/plugins/justflows.analytics/settings">
          {t("analytics.settings")}
        </Link>
      </header>

      {error && <div className="jf-alert jf-alert--error" role="alert">{error}</div>}

      {loading || !data ? (
        <div className="jf-card"><div className="jf-card__body">{t("common.loading")}</div></div>
      ) : !data.collecting ? (
        <div className="jf-card">
          <div className="jf-empty">
            <span className="jf-empty__title">{t("analytics.notCollectingTitle")}</span>
            <p>{t("analytics.notCollectingBody")}</p>
            <Link className="jf-btn jf-btn--primary" to="/admin/plugins">
              {t("analytics.openPlugins")}
            </Link>
          </div>
        </div>
      ) : (
        <div className="jf-stack">
          {!data.enabled && (
            <div className="jf-alert">{t("analytics.collectionPaused")}</div>
          )}

          <div className="jf-grid jf-grid--2">
            <div className="jf-card">
              <div className="jf-card__head"><h2 className="jf-card__title">{t("analytics.pageViews")}</h2></div>
              <div className="jf-card__body">
                <p style={{ fontSize: "2rem", fontWeight: 700, margin: 0 }}>{data.totals.views}</p>
                <p className="jf-meta">{t("analytics.last14Days")}</p>
              </div>
            </div>
            <div className="jf-card">
              <div className="jf-card__head"><h2 className="jf-card__title">{t("analytics.devices")}</h2></div>
              <div className="jf-card__body">
                {data.devices.length === 0 ? (
                  <p className="jf-meta">{t("analytics.noDeviceData")}</p>
                ) : (
                  <ul className="jf-stack jf-stack--sm" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {data.devices.map((row) => (
                      <li key={row.device} className="jf-row" style={{ justifyContent: "space-between" }}>
                        <span style={{ textTransform: "capitalize" }}>{row.device}</span>
                        <strong>{row.count}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <div className="jf-card">
            <div className="jf-card__head"><h2 className="jf-card__title">{t("analytics.viewsByDay")}</h2></div>
            <div className="jf-card__body">
              {data.daily.length === 0 ? (
                <p className="jf-meta">{t("analytics.nothingRecorded")}</p>
              ) : (
                <div className="jf-stack jf-stack--sm">
                  {data.daily.map((row) => (
                    <div key={row.day}>
                      <div className="jf-row" style={{ justifyContent: "space-between" }}>
                        <span className="jf-meta">{row.day}</span>
                        <span>{row.count}</span>
                      </div>
                      <div style={{ height: 8, background: "var(--jf-surface-2)", borderRadius: 99 }}>
                        <div
                          style={{
                            width: `${Math.round((row.count / maxDaily) * 100)}%`,
                            height: "100%",
                            background: "var(--jf-accent)",
                            borderRadius: 99,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="jf-grid jf-grid--2">
            <div className="jf-card">
              <div className="jf-card__head"><h2 className="jf-card__title">{t("analytics.topPages")}</h2></div>
              <div className="jf-card__body">
                {data.pages.length === 0 ? (
                  <p className="jf-meta">{t("analytics.noPagesYet")}</p>
                ) : (
                  <table className="jf-table">
                    <thead><tr><th>{t("analytics.path")}</th><th>{t("analytics.views")}</th></tr></thead>
                    <tbody>
                      {data.pages.map((row) => (
                        <tr key={row.path}>
                          <td className="jf-td--mono">{row.path}</td>
                          <td>{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
            <div className="jf-card">
              <div className="jf-card__head"><h2 className="jf-card__title">{t("analytics.referrers")}</h2></div>
              <div className="jf-card__body">
                {data.referrers.length === 0 ? (
                  <p className="jf-meta">{t("analytics.noReferrersYet")}</p>
                ) : (
                  <table className="jf-table">
                    <thead><tr><th>{t("analytics.source")}</th><th>{t("analytics.views")}</th></tr></thead>
                    <tbody>
                      {data.referrers.map((row) => (
                        <tr key={row.referrer}>
                          <td>{row.referrer}</td>
                          <td>{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
