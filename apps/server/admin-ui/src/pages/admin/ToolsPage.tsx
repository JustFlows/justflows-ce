import { useEffect, useRef, useState } from "react";
import { waitForSiteRestart } from "../../lib/wait-for-restart.js";

interface ImportResult {
  ok: boolean;
  imported?: { posts: number; pages: number; skipped: number };
  errors?: string[];
  error?: string;
}

interface CacheSettings {
  enabled: boolean;
  driver: "memory" | "filesystem";
  ttlSeconds: number;
  dir: string;
  redisUrl: string;
  defaultDir: string;
}

interface GzipSettings {
  enabled: boolean;
  level: number;
  minBytes: number;
}

interface BrowserCacheSettings {
  enabled: boolean;
  htmlMaxAge: number;
  staticMaxAge: number;
  staleWhileRevalidate: number;
}

interface RevalidateSettings {
  enabled: boolean;
  objects: {
    pages: boolean;
    content: boolean;
    menus: boolean;
    theme: boolean;
    cssProviders: boolean;
    site: boolean;
  };
}

interface PerformanceSettingsResponse {
  settings: {
    cache: CacheSettings;
    gzip: GzipSettings;
    browserCache: BrowserCacheSettings;
    revalidate: RevalidateSettings;
  };
  runtime: {
    active: boolean;
    driver: string;
    ttlSeconds: number;
    gzip: boolean;
    browserCache: boolean;
    revalidate: boolean;
  };
  envPath: string;
}

interface PerformanceStatsResponse {
  enabled: boolean;
  gzip: GzipSettings;
  browserCache: BrowserCacheSettings;
  revalidate?: RevalidateSettings;
  stats: {
    hits: number;
    misses: number;
    sets: number;
    deletes: number;
    invalidations: number;
    clears: number;
    hitRate: number | null;
  };
  storage: { keyCount: number; totalBytes: number; sampleKeys: string[] };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function logVariant(line: string): string {
  if (line.startsWith("✓")) return " jf-log__line--ok";
  if (line.startsWith("✗")) return " jf-log__line--fail";
  if (line.startsWith("⚠")) return " jf-log__line--warn";
  if (line.startsWith("↻")) return " jf-log__line--info";
  return "";
}

export default function ToolsPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const [perfLoading, setPerfLoading] = useState(true);
  const [cache, setCache] = useState<CacheSettings>({
    enabled: false,
    driver: "filesystem",
    ttlSeconds: 300,
    dir: "",
    redisUrl: "",
    defaultDir: "./.cache",
  });
  const [gzip, setGzip] = useState<GzipSettings>({
    enabled: false,
    level: 6,
    minBytes: 1024,
  });
  const [browserCache, setBrowserCache] = useState<BrowserCacheSettings>({
    enabled: false,
    htmlMaxAge: 60,
    staticMaxAge: 86400,
    staleWhileRevalidate: 300,
  });
  const [revalidate, setRevalidate] = useState<RevalidateSettings>({
    enabled: false,
    objects: {
      pages: true,
      content: true,
      menus: true,
      theme: true,
      cssProviders: true,
      site: true,
    },
  });
  const [envPath, setEnvPath] = useState("");
  const [runtime, setRuntime] = useState<PerformanceSettingsResponse["runtime"] | null>(null);
  const [perfSaving, setPerfSaving] = useState(false);
  const [cacheClearing, setCacheClearing] = useState(false);
  const [perfError, setPerfError] = useState<string | null>(null);
  const [perfSaved, setPerfSaved] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartFailed, setRestartFailed] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [perfStats, setPerfStats] = useState<PerformanceStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  async function loadPerfStats() {
    setStatsLoading(true);
    try {
      for (const url of ["/api/performance/stats", "/api/cache/stats"]) {
        const res = await fetch(url);
        if (res.ok) {
          setPerfStats(await res.json() as PerformanceStatsResponse);
          return;
        }
      }
    } catch {
      // non-fatal
    } finally {
      setStatsLoading(false);
    }
  }

  async function loadPerformanceSettings() {
    setPerfError(null);
    for (const url of ["/api/performance/settings", "/api/cache/settings"]) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json() as PerformanceSettingsResponse;
        setCache(data.settings.cache);
        setGzip(data.settings.gzip);
        setBrowserCache(data.settings.browserCache);
        if (data.settings.revalidate) setRevalidate(data.settings.revalidate);
        setEnvPath(data.envPath);
        setRuntime(data.runtime);
        return;
      } catch {
        // try next endpoint
      }
    }
    setPerfError("Could not load performance settings");
  }

  useEffect(() => {
    void loadPerformanceSettings().finally(() => setPerfLoading(false));
    void loadPerfStats();
  }, []);

  function addLog(line: string) {
    setLog((l) => [...l, line]);
  }

  async function importWordPress(file: File) {
    setImporting(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/import/wordpress", { method: "POST", body: form });
      setResult(await res.json() as ImportResult);
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setImporting(false);
    }
  }

  async function savePerformanceSettings() {
    setPerfError(null);
    setPerfSaved(false);
    setRestartFailed(false);
    setLog([]);
    setPerfSaving(true);

    const payload = {
      cache: {
        enabled: cache.enabled,
        driver: cache.driver,
        ttlSeconds: Number(cache.ttlSeconds),
        dir: cache.driver === "filesystem" ? cache.dir || cache.defaultDir : undefined,
        redisUrl: cache.redisUrl || undefined,
      },
      gzip: {
        enabled: gzip.enabled,
        level: Number(gzip.level),
        minBytes: Number(gzip.minBytes),
      },
      browserCache: {
        enabled: browserCache.enabled,
        htmlMaxAge: Number(browserCache.htmlMaxAge),
        staticMaxAge: Number(browserCache.staticMaxAge),
        staleWhileRevalidate: Number(browserCache.staleWhileRevalidate),
      },
      revalidate: {
        enabled: revalidate.enabled,
        objects: { ...revalidate.objects },
      },
    };

    try {
      let res = await fetch("/api/performance/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 404) {
        res = await fetch("/api/cache/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      const data = await res.json() as {
        ok?: boolean;
        error?: string;
        restarting?: boolean;
        restartRequired?: boolean;
        settings?: PerformanceSettingsResponse["settings"];
      };

      if (!res.ok) {
        throw new Error(data.error ?? "Failed to save performance settings");
      }

      if (data.settings) {
        setCache(data.settings.cache);
        setGzip(data.settings.gzip);
        setBrowserCache(data.settings.browserCache);
        if (data.settings.revalidate) setRevalidate(data.settings.revalidate);
      }
      setPerfSaved(true);
      addLog("✓ Performance settings written to .env");

      if (data.restarting) {
        setPerfSaving(false);
        setRestarting(true);
        const back = await waitForSiteRestart(addLog);
        if (!back) setRestartFailed(true);
        setRestarting(false);
      } else if (data.restartRequired) {
        setRestartFailed(true);
        addLog("⚠ Could not auto-restart — restart manually in Plesk → Node.js");
      }
    } catch (e) {
      setPerfError(e instanceof Error ? e.message : String(e));
      addLog(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPerfSaving(false);
    }
  }

  async function clearCache() {
    setPerfError(null);
    setCacheClearing(true);
    try {
      for (const url of ["/api/performance/clear", "/api/cache/clear"]) {
        const res = await fetch(url, { method: "POST" });
        const data = await res.json() as { ok?: boolean; error?: string; enabled?: boolean };
        if (!res.ok) continue;
      setRuntime((r) => (r ? { ...r, active: data.enabled ?? cache.enabled } : r));
      addLog(`✓ Object cache cleared${data.enabled === false ? " (caching is disabled)" : ""}`);
      await loadPerfStats();
      return;
      }
      throw new Error("Failed to clear cache");
    } catch (e) {
      setPerfError(e instanceof Error ? e.message : String(e));
    } finally {
      setCacheClearing(false);
    }
  }

  const perfBusy = perfSaving || restarting;

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>Tools</h1>
          <p>Import, export, and site utilities</p>
        </div>
      </header>

      <div className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">Performance suite</h2>
        </div>
        <div className="jf-card__body jf-stack">
          <p className="jf-prose">
            Object cache, GZIP compression, and browser cache headers for faster public pages.
            Responses include <code className="jf-code">X-Jf-Cache</code>,{" "}
            <code className="jf-code">X-Jf-Page-Cache</code>,{" "}
            <code className="jf-code">Content-Encoding</code>, and{" "}
            <code className="jf-code">Cache-Control</code> when active.
          </p>

          {!perfLoading && perfStats && (
            <div className="jf-stack" style={{ gap: "0.75rem" }}>
              <div className="jf-row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                <span className={`jf-badge jf-badge--${perfStats.enabled ? "ok" : "warn"}`}>
                  Object cache {perfStats.enabled ? "on" : "off"}
                </span>
                <span className={`jf-badge jf-badge--${perfStats.gzip.enabled ? "ok" : "warn"}`}>
                  GZIP {perfStats.gzip.enabled ? "on" : "off"}
                </span>
                <span className={`jf-badge jf-badge--${perfStats.browserCache.enabled ? "ok" : "warn"}`}>
                  Browser cache {perfStats.browserCache.enabled ? "on" : "off"}
                </span>
                {perfStats.revalidate && (
                  <span className={`jf-badge jf-badge--${perfStats.revalidate.enabled ? "ok" : "warn"}`}>
                    Revalidate {perfStats.revalidate.enabled ? "on" : "off"}
                  </span>
                )}
                <span className="jf-badge jf-badge--info">
                  {perfStats.stats.hits} hits / {perfStats.stats.misses} misses
                  {perfStats.stats.hitRate !== null ? ` (${perfStats.stats.hitRate}%)` : ""}
                </span>
                <span className="jf-badge jf-badge--info">
                  {perfStats.storage.keyCount} keys · {formatBytes(perfStats.storage.totalBytes)}
                </span>
                <button
                  type="button"
                  className="jf-btn jf-btn--ghost"
                  onClick={() => loadPerfStats()}
                  disabled={statsLoading}
                >
                  {statsLoading ? "Refreshing…" : "↻ Refresh stats"}
                </button>
              </div>
              {perfStats.storage.sampleKeys.length > 0 && (
                <details>
                  <summary className="jf-field__hint" style={{ cursor: "pointer" }}>
                    Sample cache files ({perfStats.storage.sampleKeys.length})
                  </summary>
                  <ul style={{ margin: "0.4rem 0 0", paddingInlineStart: "1.1rem", fontSize: "0.85rem" }}>
                    {perfStats.storage.sampleKeys.map((key) => (
                      <li key={key}><code>{key}</code></li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {perfLoading ? (
            <div className="jf-skeleton" style={{ height: 420 }} />
          ) : (
            <>
              <hr className="jf-divider" />

              <h3 className="jf-card__subtitle">Object cache (jf-cache)</h3>
              <p className="jf-field__hint">
                Read-through cache for content, menus, theme data, and full HTML pages.
              </p>

              <div className="jf-row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                <span className={`jf-badge jf-badge--${cache.enabled ? "ok" : "warn"}`}>
                  {cache.enabled ? "Enabled" : "Disabled"}
                </span>
                <span className="jf-badge jf-badge--info">{cache.driver}</span>
                {runtime !== null && runtime.active !== cache.enabled && (
                  <span className="jf-badge jf-badge--warn">Restart required to apply</span>
                )}
              </div>

              <label className="jf-checkrow">
                <input
                  type="checkbox"
                  checked={cache.enabled}
                  onChange={(e) => setCache((s) => ({ ...s, enabled: e.target.checked }))}
                  disabled={perfBusy}
                />
                <span>Enable object cache</span>
              </label>

              <div className="jf-grid jf-grid--2">
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jf-cache-driver">Driver</label>
                  <select
                    id="jf-cache-driver"
                    className="jf-input"
                    value={cache.driver}
                    onChange={(e) =>
                      setCache((s) => ({
                        ...s,
                        driver: e.target.value as "memory" | "filesystem",
                      }))
                    }
                    disabled={perfBusy}
                  >
                    <option value="filesystem">Filesystem (default, survives restarts)</option>
                    <option value="memory">Memory (per process, fastest)</option>
                  </select>
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jf-cache-ttl">TTL (seconds)</label>
                  <input
                    id="jf-cache-ttl"
                    className="jf-input"
                    type="number"
                    min={0}
                    max={86400}
                    value={cache.ttlSeconds}
                    onChange={(e) =>
                      setCache((s) => ({ ...s, ttlSeconds: Number(e.target.value) || 0 }))
                    }
                    disabled={perfBusy}
                  />
                </div>
              </div>

              {cache.driver === "filesystem" && (
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jf-cache-dir">Cache directory</label>
                  <input
                    id="jf-cache-dir"
                    className="jf-input"
                    value={cache.dir || cache.defaultDir}
                    placeholder={cache.defaultDir}
                    onChange={(e) => setCache((s) => ({ ...s, dir: e.target.value }))}
                    disabled={perfBusy}
                  />
                </div>
              )}

              <hr className="jf-divider" />

              <h3 className="jf-card__subtitle">Revalidate on update</h3>
              <p className="jf-field__hint">
                When content, menus, theme, or settings change, clear the selected cache layers
                immediately. Turn off to rely on TTL only. Fires the{" "}
                <code className="jf-code">cache.revalidated</code> hook for plugins.
              </p>

              <label className="jf-checkrow">
                <input
                  type="checkbox"
                  checked={revalidate.enabled}
                  onChange={(e) =>
                    setRevalidate((s) => ({ ...s, enabled: e.target.checked }))
                  }
                  disabled={perfBusy}
                />
                <span>Revalidate selected objects when data changes</span>
              </label>

              <div className="jf-grid jf-grid--2" style={{ opacity: revalidate.enabled ? 1 : 0.55 }}>
                {(
                  [
                    ["pages", "Full HTML pages"],
                    ["content", "Content entries (posts / pages)"],
                    ["menus", "Menus"],
                    ["theme", "Theme customizations"],
                    ["cssProviders", "CSS providers"],
                    ["site", "Site context"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="jf-checkrow">
                    <input
                      type="checkbox"
                      checked={revalidate.objects[key]}
                      onChange={(e) =>
                        setRevalidate((s) => ({
                          ...s,
                          objects: { ...s.objects, [key]: e.target.checked },
                        }))
                      }
                      disabled={perfBusy || !revalidate.enabled}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>

              <hr className="jf-divider" />

              <h3 className="jf-card__subtitle">GZIP compression</h3>
              <p className="jf-field__hint">
                Compresses HTML, JSON, CSS, and JavaScript when the browser accepts gzip.
              </p>

              <label className="jf-checkrow">
                <input
                  type="checkbox"
                  checked={gzip.enabled}
                  onChange={(e) => setGzip((s) => ({ ...s, enabled: e.target.checked }))}
                  disabled={perfBusy}
                />
                <span>Enable GZIP compression</span>
              </label>

              <div className="jf-grid jf-grid--2">
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jf-gzip-level">Compression level</label>
                  <input
                    id="jf-gzip-level"
                    className="jf-input"
                    type="number"
                    min={1}
                    max={9}
                    value={gzip.level}
                    onChange={(e) =>
                      setGzip((s) => ({ ...s, level: Number(e.target.value) || 6 }))
                    }
                    disabled={perfBusy || !gzip.enabled}
                  />
                  <p className="jf-field__hint">1 = fastest, 9 = smallest (default 6).</p>
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jf-gzip-min">Minimum size (bytes)</label>
                  <input
                    id="jf-gzip-min"
                    className="jf-input"
                    type="number"
                    min={256}
                    max={65536}
                    value={gzip.minBytes}
                    onChange={(e) =>
                      setGzip((s) => ({ ...s, minBytes: Number(e.target.value) || 1024 }))
                    }
                    disabled={perfBusy || !gzip.enabled}
                  />
                  <p className="jf-field__hint">Skip compression for tiny responses.</p>
                </div>
              </div>

              <hr className="jf-divider" />

              <h3 className="jf-card__subtitle">Browser cache</h3>
              <p className="jf-field__hint">
                Sets <code className="jf-code">Cache-Control</code> on public HTML and static files.
                Admin and API routes always get <code className="jf-code">no-store</code>.
              </p>

              <label className="jf-checkrow">
                <input
                  type="checkbox"
                  checked={browserCache.enabled}
                  onChange={(e) =>
                    setBrowserCache((s) => ({ ...s, enabled: e.target.checked }))
                  }
                  disabled={perfBusy}
                />
                <span>Enable browser cache headers</span>
              </label>

              <div className="jf-grid jf-grid--3">
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jf-bc-html">HTML max-age (s)</label>
                  <input
                    id="jf-bc-html"
                    className="jf-input"
                    type="number"
                    min={0}
                    max={86400}
                    value={browserCache.htmlMaxAge}
                    onChange={(e) =>
                      setBrowserCache((s) => ({
                        ...s,
                        htmlMaxAge: Number(e.target.value) || 0,
                      }))
                    }
                    disabled={perfBusy || !browserCache.enabled}
                  />
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jf-bc-static">Static max-age (s)</label>
                  <input
                    id="jf-bc-static"
                    className="jf-input"
                    type="number"
                    min={0}
                    max={31536000}
                    value={browserCache.staticMaxAge}
                    onChange={(e) =>
                      setBrowserCache((s) => ({
                        ...s,
                        staticMaxAge: Number(e.target.value) || 0,
                      }))
                    }
                    disabled={perfBusy || !browserCache.enabled}
                  />
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jf-bc-swr">Stale-while-revalidate (s)</label>
                  <input
                    id="jf-bc-swr"
                    className="jf-input"
                    type="number"
                    min={0}
                    max={86400}
                    value={browserCache.staleWhileRevalidate}
                    onChange={(e) =>
                      setBrowserCache((s) => ({
                        ...s,
                        staleWhileRevalidate: Number(e.target.value) || 0,
                      }))
                    }
                    disabled={perfBusy || !browserCache.enabled}
                  />
                </div>
              </div>

              {envPath && (
                <p className="jf-field__hint">
                  Config file: <code className="jf-code">{envPath}</code>
                </p>
              )}

              <div className="jf-row">
                <button
                  className="jf-btn jf-btn--primary"
                  onClick={savePerformanceSettings}
                  disabled={perfBusy || cacheClearing}
                >
                  {perfSaving ? "Saving…" : restarting ? "Restarting…" : "Save all & restart app"}
                </button>
                <button
                  className="jf-btn jf-btn--ghost"
                  onClick={clearCache}
                  disabled={perfBusy || cacheClearing}
                >
                  {cacheClearing ? "Clearing…" : "Clear object cache"}
                </button>
                {perfSaved && !perfBusy && (
                  <span className="jf-status jf-status--saved">✓ Saved</span>
                )}
                {perfError && (
                  <span className="jf-status jf-status--error">{perfError}</span>
                )}
              </div>

              {restartFailed && (
                <div className="jf-banner jf-banner--warn">
                  <span className="jf-banner__icon" aria-hidden="true">⚠️</span>
                  <div>
                    <div className="jf-banner__title">Manual restart needed</div>
                    <div className="jf-banner__sub">
                      Go to Plesk → Node.js → Restart App, then refresh this page.
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {log.length > 0 && (
        <div className="jf-log">
          <p className="jf-log__label">Performance log</p>
          {log.map((line, i) => (
            <p key={i} className={`jf-log__line${logVariant(line)}`}>{line}</p>
          ))}
        </div>
      )}

      <div className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">Import from WordPress</h2>
        </div>
        <div className="jf-card__body jf-stack">
          <p className="jf-prose">
            Upload a WordPress export file (.xml from Tools → Export in the WordPress admin)
            to bring your posts and pages across.
          </p>

          <input
            ref={fileRef}
            type="file"
            accept=".xml"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importWordPress(f); }}
          />

          <div className="jf-row">
            <button
              className="jf-btn jf-btn--primary"
              onClick={() => fileRef.current?.click()}
              disabled={importing}
            >
              {importing ? "Importing…" : "Upload WordPress .xml"}
            </button>
          </div>

          {result && (result.ok ? (
            <div className="jf-alert jf-alert--success">
              <div>
                <strong>✓ Import complete</strong>
                <ul style={{ margin: "0.4rem 0 0", paddingInlineStart: "1.1rem" }}>
                  <li>Posts imported: {result.imported?.posts}</li>
                  <li>Pages imported: {result.imported?.pages}</li>
                  <li>Skipped: {result.imported?.skipped}</li>
                </ul>
                {result.errors && result.errors.length > 0 && (
                  <p style={{ margin: "0.4rem 0 0" }}>
                    {result.errors.length} item(s) had errors. Check the server logs.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="jf-alert jf-alert--error" role="alert">
              <strong>Import failed:</strong>&nbsp;{result.error}
            </div>
          ))}
        </div>
      </div>

      <div className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">Export</h2>
        </div>
        <div className="jf-card__body jf-stack">
          <p className="jf-prose">Export your site content as a JSON archive.</p>
          <div className="jf-row">
            <button className="jf-btn jf-btn--ghost" disabled>Export site (coming soon)</button>
          </div>
        </div>
      </div>
    </div>
  );
}
