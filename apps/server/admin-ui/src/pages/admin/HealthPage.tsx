import { useEffect, useState } from "react";

interface DiagnosticsReport {
  generatedAt: string;
  runtime: { justflowsVersion: string; nodeVersion: string; mode: string; uptimeSeconds: number; memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number; systemUsedBytes: number; systemTotalBytes: number }; debug: { enabled: boolean; expiresAt?: string | null }; warnings: string[] };
  database: { driver: string; connected: boolean; latencyMs: number; migrations: { applied: number; current: boolean; pending: string[] } };
  cache: { enabled: boolean; stats: { hits: number; misses: number; hitRate: number | null } };
  extensions: {
    plugins: Array<{ id: string; name: string; version: string; source: "development" | "marketplace" | "database"; status: string; registered: boolean; onDisk: boolean; permissions: string[]; path: string | null }>;
    themes: Array<{ id: string; name: string; version: string; source: "development" | "marketplace" | "database"; status: string; registered: boolean; onDisk: boolean; permissions: string[]; path: string | null }>;
  };
  hooks: { totals: { handlers: number; runs: number; errors: number; disabled: number }; handlers: Array<{ hook: string; pluginId: string | null; priority: number; runs: number; errors: number; totalMs: number; disabled: boolean }> };
  errors: Array<{ id: string; timestamp: string; requestId: string | null; context: string; message: string }>;
  traces: Array<{ requestId: string; timestamp: string; path: string; durationMs: number; pageCache: string; objectCache: string; databaseQueries: number; databaseMs: number; hookRuns: number; hookErrors: number; theme: string; template: string }>;
}

const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
}

export default function HealthPage() {
  const requestedTraceId = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("requestId") ?? "";
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bundleBusy, setBundleBusy] = useState(false);
  const [debugBusy, setDebugBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/diagnostics");
      const data = await res.json() as DiagnosticsReport & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Diagnostics unavailable");
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function downloadBundle() {
    if (!window.confirm("Download this diagnostics report? Secrets, request bodies, uploads, and database contents are excluded.")) return;
    setBundleBusy(true);
    setError("");
    try {
      const res = await fetch("/api/diagnostics/bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Bundle generation failed");
      }
      const url = URL.createObjectURL(await res.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `justflows-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json.gz`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBundleBusy(false);
    }
  }

  async function setDebugMode(enabled: boolean) {
    setDebugBusy(true);
    setError("");
    try {
      const res = await fetch("/api/diagnostics/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, expiresInHours: 4 }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not update debug mode");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDebugBusy(false);
    }
  }

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>Diagnostics</h1>
          <p>System health, runtime details, and troubleshooting information.</p>
        </div>
        <div className="jf-pagehead__actions">
          <button type="button" className="jf-btn jf-btn--ghost" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" className="jf-btn jf-btn--primary" onClick={() => void downloadBundle()} disabled={!report || bundleBusy}>
            {bundleBusy ? "Preparing…" : "Download support bundle"}
          </button>
        </div>
      </header>

      {error && <div className="jf-alert jf-alert--error" role="alert">{error}</div>}
      {report?.runtime.warnings.map((warning) => (
        <div className="jf-banner jf-banner--warn" role="alert" key={warning}>
          <span className="jf-banner__icon" aria-hidden="true">⚠</span>
          <div><div className="jf-banner__title">Debug mode is active</div><div className="jf-banner__sub">{warning}</div></div>
        </div>
      ))}

      {loading && !report && <div className="jf-card"><div className="jf-card__body"><div className="jf-skeleton" style={{ height: 320 }} /></div></div>}

      {report && <>
        {(() => {
          const heapPercent = Math.round((report.runtime.memory.heapUsedBytes / Math.max(1, report.runtime.memory.heapTotalBytes)) * 100);
          const systemPercent = Math.round((report.runtime.memory.systemUsedBytes / Math.max(1, report.runtime.memory.systemTotalBytes)) * 100);
          const hasIssues = !report.database.connected || !report.database.migrations.current || report.hooks.totals.errors > 0 || report.errors.length > 0;
          return <>
            <div className={`jf-banner jf-banner--${hasIssues ? "warn" : "ok"}`}>
              <span className="jf-banner__icon" aria-hidden="true">{hasIssues ? "⚠" : "✓"}</span>
              <div><div className="jf-banner__title">{hasIssues ? "Diagnostics found items to review" : "All monitored systems are healthy"}</div><div className="jf-banner__sub">Database {report.database.connected ? "connected" : "unavailable"} · migrations {report.database.migrations.current ? "current" : "pending"} · {report.errors.length} recent errors</div></div>
            </div>

            <div className="jf-diagnostics-overview">
              <div className="jf-diagnostic-stat"><span className="jf-diagnostic-stat__label">Process heap</span><strong>{formatBytes(report.runtime.memory.heapUsedBytes)}</strong><span>{heapPercent}% of {formatBytes(report.runtime.memory.heapTotalBytes)}</span><div className="jf-meter" role="meter" aria-label="Node.js heap usage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={heapPercent}><span style={{ width: `${Math.min(100, heapPercent)}%` }} /></div></div>
              <div className="jf-diagnostic-stat"><span className="jf-diagnostic-stat__label">System memory</span><strong>{formatBytes(report.runtime.memory.systemUsedBytes)}</strong><span>{systemPercent}% of {formatBytes(report.runtime.memory.systemTotalBytes)}</span><div className="jf-meter" role="meter" aria-label="System memory usage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={systemPercent}><span style={{ width: `${Math.min(100, systemPercent)}%` }} /></div></div>
              <div className="jf-diagnostic-stat"><span className="jf-diagnostic-stat__label">Cache hit rate</span><strong>{report.cache.stats.hitRate === null ? "—" : `${report.cache.stats.hitRate}%`}</strong><span>{report.cache.stats.hits + report.cache.stats.misses} requests observed</span><div className="jf-meter" role="meter" aria-label="Cache hit rate" aria-valuemin={0} aria-valuemax={100} aria-valuenow={report.cache.stats.hitRate ?? 0}><span style={{ width: `${report.cache.stats.hitRate ?? 0}%` }} /></div></div>
              <div className="jf-diagnostic-stat"><span className="jf-diagnostic-stat__label">Database latency</span><strong>{report.database.latencyMs} ms</strong><span>{report.database.driver} · connected</span><span className={`jf-badge jf-badge--${report.database.latencyMs > 250 ? "warn" : "ok"}`}>{report.database.latencyMs > 250 ? "Slow" : "Responsive"}</span></div>
            </div>
          </>;
        })()}

        <div className="jf-grid jf-grid--2">
          <section className="jf-card">
            <div className="jf-card__head"><h2 className="jf-card__title">Runtime</h2><span className={`jf-badge jf-badge--${report.runtime.debug.enabled ? "warn" : "ok"}`}>Debug {report.runtime.debug.enabled ? "on" : "off"}</span></div>
            <div className="jf-card__body"><dl className="jf-diagnostics-list">
              <div><dt>Justflows</dt><dd>{report.runtime.justflowsVersion}</dd></div>
              <div><dt>Node.js</dt><dd>{report.runtime.nodeVersion}</dd></div>
              <div><dt>Mode</dt><dd>{report.runtime.mode}</dd></div>
              <div><dt>Uptime</dt><dd>{formatUptime(report.runtime.uptimeSeconds)}</dd></div>
              <div><dt>Memory</dt><dd>{formatBytes(report.runtime.memory.heapUsedBytes)} heap · {formatBytes(report.runtime.memory.rssBytes)} RSS</dd></div>
            </dl></div>
          </section>

          <section className="jf-card">
            <div className="jf-card__head"><h2 className="jf-card__title">Services</h2></div>
            <div className="jf-card__body"><dl className="jf-diagnostics-list">
              <div><dt>Database</dt><dd><span className={`jf-badge jf-badge--${report.database.connected ? "ok" : "error"}`}>{report.database.driver}</span></dd></div>
              <div><dt>Latency</dt><dd>{report.database.latencyMs} ms</dd></div>
              <div><dt>Migrations</dt><dd><span className={`jf-badge jf-badge--${report.database.migrations.current ? "ok" : "warn"}`}>{report.database.migrations.current ? "Current" : `${report.database.migrations.pending.length} pending`}</span></dd></div>
              <div><dt>Object cache</dt><dd><span className={`jf-badge jf-badge--${report.cache.enabled ? "ok" : "warn"}`}>{report.cache.enabled ? "Enabled" : "Disabled"}</span></dd></div>
              <div><dt>Cache activity</dt><dd>{report.cache.stats.hits} hits · {report.cache.stats.misses} misses{report.cache.stats.hitRate === null ? "" : ` · ${report.cache.stats.hitRate}%`}</dd></div>
            </dl></div>
          </section>
        </div>

        <section className="jf-card">
          <div className="jf-card__head"><div><h2 className="jf-card__title">Developer debug mode</h2><p className="jf-field__hint">Adds diagnostic context while keeping authentication, security headers, rate limits, and safe public errors enabled.</p></div><span className={`jf-badge jf-badge--${report.runtime.debug.enabled ? "warn" : "ok"}`}>{report.runtime.debug.enabled ? "Active" : "Off"}</span></div>
          <div className="jf-card__body jf-stack">
            <p className="jf-prose">Enable debug mode temporarily when investigating a problem. It expires automatically after four hours and can be disabled here at any time.</p>
            {report.runtime.debug.enabled && report.runtime.debug.expiresAt && <p className="jf-field__hint">Automatic expiry: {new Date(report.runtime.debug.expiresAt).toLocaleString()}</p>}
            <div className="jf-row">
              <button type="button" className={`jf-btn ${report.runtime.debug.enabled ? "jf-btn--danger" : "jf-btn--primary"}`} onClick={() => void setDebugMode(!report.runtime.debug.enabled)} disabled={debugBusy}>{debugBusy ? "Updating…" : report.runtime.debug.enabled ? "Disable debug mode" : "Enable for 4 hours"}</button>
              <span className="jf-field__hint">Manual configuration: <code className="jf-code">JF_DEBUG=true</code> and optional <code className="jf-code">JF_DEBUG_EXPIRES_AT</code> in <code className="jf-code">.env</code>.</span>
            </div>
          </div>
        </section>

        <section className="jf-card">
          <div className="jf-card__head"><div><h2 className="jf-card__title">Request traces</h2><p className="jf-field__hint">Recent administrator debug requests from the public site.</p></div><span className="jf-badge jf-badge--info">{report.traces.length} retained</span></div>
          <div className="jf-card__body jf-card__body--flush">
            {report.traces.length === 0 ? <div className="jf-empty"><p>Open a public page while debug mode is active to capture a trace.</p></div> : <div className="jf-tablewrap"><table className="jf-table"><thead><tr><th>Request</th><th>Page</th><th>Time</th><th>Cache</th><th>Database</th><th>Hooks</th><th>Resolution</th></tr></thead><tbody>{report.traces.map((trace) => <tr key={trace.requestId} className={trace.requestId === requestedTraceId ? "jf-table__row--highlight" : undefined}><td className="jf-td--mono">{trace.requestId}</td><td><strong>{trace.path}</strong><br /><span className="jf-field__hint">{new Date(trace.timestamp).toLocaleTimeString()}</span></td><td>{trace.durationMs.toFixed(1)} ms</td><td>{trace.pageCache}<br /><span className="jf-field__hint">{trace.objectCache}</span></td><td>{trace.databaseQueries} ops<br /><span className="jf-field__hint">{trace.databaseMs.toFixed(1)} ms</span></td><td>{trace.hookRuns} runs<br /><span className="jf-field__hint">{trace.hookErrors} errors</span></td><td><code className="jf-code">{trace.theme}</code><br /><span className="jf-field__hint">{trace.template}</span></td></tr>)}</tbody></table></div>}
          </div>
        </section>

        <section className="jf-card">
          <div className="jf-card__head"><div><h2 className="jf-card__title">Hook inspector</h2><p className="jf-field__hint">Typed handlers registered by core and active plugins.</p></div><div className="jf-row"><span className="jf-badge jf-badge--info">{report.hooks.totals.handlers} handlers</span><span className={`jf-badge jf-badge--${report.hooks.totals.errors ? "error" : "ok"}`}>{report.hooks.totals.errors} errors</span></div></div>
          <div className="jf-card__body jf-card__body--flush">
            {report.hooks.handlers.length === 0 ? <div className="jf-empty"><p>No hook handlers are registered.</p></div> : <div className="jf-tablewrap"><table className="jf-table"><thead><tr><th>Hook</th><th>Owner</th><th>Priority</th><th>Runs</th><th>Duration</th><th>Status</th></tr></thead><tbody>{report.hooks.handlers.map((hook, index) => <tr key={`${hook.hook}-${hook.priority}-${index}`}><td className="jf-td--mono">{hook.hook}</td><td>{hook.pluginId ?? "Core"}</td><td>{hook.priority}</td><td>{hook.runs}</td><td>{hook.totalMs.toFixed(1)} ms</td><td><span className={`jf-badge jf-badge--${hook.disabled || hook.errors ? "error" : "ok"}`}>{hook.disabled ? "Disabled" : hook.errors ? `${hook.errors} errors` : "Healthy"}</span></td></tr>)}</tbody></table></div>}
          </div>
        </section>

        <section className="jf-card">
          <div className="jf-card__head"><div><h2 className="jf-card__title">Plugins</h2><p className="jf-field__hint">Development plugins and Marketplace packages, joined with their database state.</p></div><span className="jf-badge jf-badge--info">{report.extensions.plugins.length} found</span></div>
          <div className="jf-card__body jf-card__body--flush">
            {report.extensions.plugins.length === 0 ? <div className="jf-empty"><p>No plugins were found.</p></div> : <div className="jf-tablewrap"><table className="jf-table"><thead><tr><th>Plugin</th><th>Source</th><th>Version</th><th>Permissions</th><th>Database</th><th>Files</th></tr></thead><tbody>{report.extensions.plugins.map((plugin, index) => <tr key={`${plugin.source}-${plugin.id}-${plugin.version}-${index}`}><td><strong>{plugin.name}</strong><br /><code className="jf-code">{plugin.id}</code>{plugin.path && <><br /><span className="jf-field__hint">{plugin.path}</span></>}</td><td><span className={`jf-badge jf-badge--${plugin.source === "development" ? "warn" : "info"}`}>{plugin.source}</span></td><td>{plugin.version}</td><td className="jf-td--muted">{plugin.permissions.join(", ") || "None"}</td><td><span className={`jf-badge jf-badge--${plugin.registered ? plugin.status === "error" ? "error" : plugin.status === "active" ? "ok" : "info" : "warn"}`}>{plugin.registered ? plugin.status : "Not registered"}</span></td><td><span className={`jf-badge jf-badge--${plugin.onDisk ? "ok" : "error"}`}>{plugin.onDisk ? "Present" : "Missing"}</span></td></tr>)}</tbody></table></div>}
          </div>
        </section>

        <section className="jf-card">
          <div className="jf-card__head"><div><h2 className="jf-card__title">Themes</h2><p className="jf-field__hint">Development themes and Marketplace packages, joined with their database activation state.</p></div><span className="jf-badge jf-badge--info">{report.extensions.themes.length} found</span></div>
          <div className="jf-card__body jf-card__body--flush">
            {report.extensions.themes.length === 0 ? <div className="jf-empty"><p>No themes were found.</p></div> : <div className="jf-tablewrap"><table className="jf-table"><thead><tr><th>Theme</th><th>Source</th><th>Version</th><th>Database</th><th>Files</th></tr></thead><tbody>{report.extensions.themes.map((theme, index) => <tr key={`${theme.source}-${theme.id}-${theme.version}-${index}`}><td><strong>{theme.name}</strong><br /><code className="jf-code">{theme.id}</code>{theme.path && <><br /><span className="jf-field__hint">{theme.path}</span></>}</td><td><span className={`jf-badge jf-badge--${theme.source === "development" ? "warn" : "info"}`}>{theme.source}</span></td><td>{theme.version}</td><td><span className={`jf-badge jf-badge--${theme.registered ? theme.status === "error" ? "error" : theme.status === "active" ? "ok" : "info" : "warn"}`}>{theme.registered ? theme.status : "Not registered"}</span></td><td><span className={`jf-badge jf-badge--${theme.onDisk ? "ok" : "error"}`}>{theme.onDisk ? "Present" : "Missing"}</span></td></tr>)}</tbody></table></div>}
          </div>
        </section>

        <section className="jf-card">
          <div className="jf-card__head"><div><h2 className="jf-card__title">Recent errors</h2><p className="jf-field__hint">Sanitized messages grouped by request ID. Stack traces, request bodies, and credentials are excluded.</p></div><span className={`jf-badge jf-badge--${report.errors.length ? "warn" : "ok"}`}>{report.errors.length} captured</span></div>
          <div className="jf-card__body jf-card__body--flush">
            {report.errors.length === 0 ? <div className="jf-empty"><p>No application errors have been captured during this process.</p></div> : <div className="jf-tablewrap"><table className="jf-table"><thead><tr><th>Time</th><th>Context</th><th>Message</th><th>Request ID</th></tr></thead><tbody>{report.errors.map((entry) => <tr key={entry.id}><td>{new Date(entry.timestamp).toLocaleTimeString()}</td><td className="jf-td--strong">{entry.context}</td><td>{entry.message}</td><td className="jf-td--mono">{entry.requestId ?? "Background task"}</td></tr>)}</tbody></table></div>}
          </div>
        </section>

        <div className="jf-banner jf-banner--ok">
          <span className="jf-banner__icon" aria-hidden="true">✓</span>
          <div><div className="jf-banner__title">Safe to share with support</div><div className="jf-banner__sub">The bundle contains only the diagnostics shown here and is not retained on the server. Last checked {new Date(report.generatedAt).toLocaleString()}.</div></div>
        </div>
      </>}
    </div>
  );
}
