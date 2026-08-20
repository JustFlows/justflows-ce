import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

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
          <h1>Analytics</h1>
          <p>Page views, referrers, and devices stored on this site. Google only sees visits if you added a tag.</p>
        </div>
        <Link className="jf-btn jf-btn--ghost" to="/admin/plugins/justflows.analytics/settings">
          Settings
        </Link>
      </header>

      {error && <div className="jf-alert jf-alert--error" role="alert">{error}</div>}

      {loading || !data ? (
        <div className="jf-card"><div className="jf-card__body">Loading…</div></div>
      ) : !data.collecting ? (
        <div className="jf-card">
          <div className="jf-empty">
            <span className="jf-empty__title">Analytics is not collecting</span>
            <p>Install Analytics from the marketplace, or activate it under Plugins if it is deactivated.</p>
            <Link className="jf-btn jf-btn--primary" to="/admin/plugins">
              Open Plugins
            </Link>
          </div>
        </div>
      ) : (
        <div className="jf-stack">
          {!data.enabled && (
            <div className="jf-alert">Collection is paused in plugin settings.</div>
          )}

          <div className="jf-grid jf-grid--2">
            <div className="jf-card">
              <div className="jf-card__head"><h2 className="jf-card__title">Page views</h2></div>
              <div className="jf-card__body">
                <p style={{ fontSize: "2rem", fontWeight: 700, margin: 0 }}>{data.totals.views}</p>
                <p className="jf-meta">Last 14 days of recorded public visits</p>
              </div>
            </div>
            <div className="jf-card">
              <div className="jf-card__head"><h2 className="jf-card__title">Devices</h2></div>
              <div className="jf-card__body">
                {data.devices.length === 0 ? (
                  <p className="jf-meta">No device data yet. Visit the public site, then refresh.</p>
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
            <div className="jf-card__head"><h2 className="jf-card__title">Views by day</h2></div>
            <div className="jf-card__body">
              {data.daily.length === 0 ? (
                <p className="jf-meta">Nothing recorded yet.</p>
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
              <div className="jf-card__head"><h2 className="jf-card__title">Top pages</h2></div>
              <div className="jf-card__body">
                {data.pages.length === 0 ? (
                  <p className="jf-meta">No pages yet.</p>
                ) : (
                  <table className="jf-table">
                    <thead><tr><th>Path</th><th>Views</th></tr></thead>
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
              <div className="jf-card__head"><h2 className="jf-card__title">Referrers</h2></div>
              <div className="jf-card__body">
                {data.referrers.length === 0 ? (
                  <p className="jf-meta">No referrers yet.</p>
                ) : (
                  <table className="jf-table">
                    <thead><tr><th>Source</th><th>Views</th></tr></thead>
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
