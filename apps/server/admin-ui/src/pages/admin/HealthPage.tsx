import { useEffect, useState } from "react";

interface Check {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

interface HealthReport {
  status: "ok" | "warn" | "error";
  checks: Check[];
  uptime: number;
  timestamp: string;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${seconds % 60}s`;
}

const OVERALL: Record<HealthReport["status"], { icon: string; title: string }> = {
  ok: { icon: "✅", title: "All systems operational" },
  warn: { icon: "⚠️", title: "Some warnings" },
  error: { icon: "❌", title: "Issues detected" },
};

export default function HealthPage() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/health");
      setReport(await res.json() as HealthReport);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const overall = report ? OVERALL[report.status] : null;

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>Site Health</h1>
          <p>System status and diagnostics</p>
        </div>
        <div className="jf-pagehead__actions">
          <button className="jf-btn jf-btn--ghost" onClick={load} disabled={loading}>
            ↻ {loading ? "Checking…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && <div className="jf-alert jf-alert--error" role="alert">{error}</div>}

      {loading && !report && (
        <>
          <div className="jf-skeleton" style={{ height: 86 }} />
          <div className="jf-skeleton" style={{ height: 240 }} />
        </>
      )}

      {report && overall && (
        <>
          <div className={`jf-banner jf-banner--${report.status}`}>
            <span className="jf-banner__icon" aria-hidden="true">{overall.icon}</span>
            <div>
              <div className="jf-banner__title">{overall.title}</div>
              <div className="jf-banner__sub">
                Uptime {formatUptime(report.uptime)} · checked {new Date(report.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </div>

          <div className="jf-card">
            <div className="jf-list">
              {report.checks.map((check) => (
                <div key={check.name} className="jf-list__row" style={{ alignItems: "center" }}>
                  <div className="jf-list__main">
                    <div className="jf-list__title">{check.name}</div>
                    <p className="jf-list__desc">{check.message}</p>
                  </div>
                  <span className={`jf-badge jf-badge--${check.status}`}>{check.status}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
