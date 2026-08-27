import { useEffect, useRef, useState } from "react";
import { initialJson } from "../../ssr-data";

interface UpdateStep {
  step: string;
  ok: boolean;
  detail?: string;
}

interface UpdateItem {
  id: string;
  name: string;
  type: "core" | "plugin" | "theme";
  currentVersion: string;
  availableVersion: string;
  changelog?: string;
}

function logVariant(line: string): string {
  if (line.startsWith("✓")) return " jf-log__line--ok";
  if (line.startsWith("✗")) return " jf-log__line--fail";
  if (line.startsWith("⚠")) return " jf-log__line--warn";
  if (line.startsWith("↻")) return " jf-log__line--info";
  return "";
}

export default function UpdatesPage() {
  const prefetched = initialJson<{
    currentVersion?: string;
    version?: string;
    updates?: UpdateItem[];
  }>("/api/updates");
  const [currentVersion, setCurrentVersion] = useState(
    prefetched?.currentVersion ?? prefetched?.version ?? "…",
  );
  const [updates, setUpdates] = useState<UpdateItem[]>(prefetched?.updates ?? []);
  const [checking, setChecking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [restartFailed, setRestartFailed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/updates")
      .then((r) => r.json())
      .then((data: { currentVersion?: string }) => {
        if (data.currentVersion) setCurrentVersion(data.currentVersion);
      })
      .catch(() => {});
  }, []);

  function addLog(line: string) {
    setLog((l) => [...l, line]);
  }

  async function checkForUpdates() {
    setChecking(true);
    setLog([]);
    try {
      const res = await fetch("/api/updates");
      const data = (await res.json()) as { updates: UpdateItem[]; currentVersion?: string };
      setUpdates(data.updates ?? []);
      if (data.currentVersion) setCurrentVersion(data.currentVersion);
      addLog(
        data.updates?.length
          ? `Found ${data.updates.length} update(s)`
          : "Everything is up to date",
      );
    } finally {
      setChecking(false);
    }
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForSiteBack() {
    setRestarting(true);
    addLog("↻ App is restarting — waiting for site to come back…");
    await sleep(4000);

    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const res = await fetch("/api/install/status", { cache: "no-store" });
        if (res.ok) {
          addLog("✓ Site is back online — reloading…");
          await sleep(1500);
          window.location.reload();
          return;
        }
      } catch {
        // expected while Passenger restarts
      }
      await sleep(2000);
    }

    setRestartFailed(true);
    addLog("⚠ Restart may still be in progress — refresh the page manually if needed");
    setRestarting(false);
  }

  async function uploadZip(file: File) {
    setUploading(true);
    setRestarting(false);
    setRestartFailed(false);
    setLog([]);
    addLog(`Uploading ${file.name}…`);

    try {
      const form = new FormData();
      form.append("file", file);

      addLog("This may take several minutes (extract → npm install → build)…");

      const res = await fetch("/api/updates/upload", { method: "POST", body: form });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        steps?: UpdateStep[];
        currentVersion?: string;
        newVersion?: string;
        restartRequired?: boolean;
        restarting?: boolean;
      };

      if (data.steps) {
        for (const step of data.steps) {
          addLog(`${step.ok ? "✓" : "✗"} ${step.step}${step.detail ? `: ${step.detail}` : ""}`);
        }
      }

      if (!res.ok) {
        throw new Error(data.error ?? data.steps?.find((s) => !s.ok)?.detail ?? "Update failed");
      }

      if (data.newVersion) setCurrentVersion(data.newVersion);

      if (data.restarting) {
        await waitForSiteBack();
      } else if (data.restartRequired) {
        setRestartFailed(true);
        addLog("⚠ Could not auto-restart — restart manually in Plesk → Node.js");
      }
    } catch (e) {
      addLog(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const busy = uploading || restarting;

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>Updates</h1>
          <p>
            Current version: <strong>v{currentVersion}</strong>
          </p>
        </div>
        <div className="jf-pagehead__actions">
          <button
            className="jf-btn jf-btn--ghost"
            onClick={checkForUpdates}
            disabled={checking || busy}
          >
            {checking ? "Checking…" : "Check for updates"}
          </button>
        </div>
      </header>

      <div className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">Upload Justflows update</h2>
        </div>
        <div className="jf-card__body jf-stack">
          <p className="jf-prose">
            Upload a <code className="jf-code">justflows.zip</code> file. Justflows extracts it,
            updates the database, installs dependencies, and restarts the site by itself
            (Plesk/Passenger). Your <code className="jf-code">.env</code> and uploads are preserved.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadZip(f);
            }}
          />

          <div className="jf-row">
            <button
              className="jf-btn jf-btn--primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              {uploading
                ? "Updating… (please wait)"
                : restarting
                  ? "Restarting…"
                  : "Choose justflows.zip…"}
            </button>
            {busy && (
              <span className="jf-meta">
                {uploading
                  ? "Running npm install and build — do not close this page"
                  : "Waiting for app to restart — page will reload automatically"}
              </span>
            )}
          </div>

          {restartFailed && (
            <div className="jf-banner jf-banner--warn">
              <span className="jf-banner__icon" aria-hidden="true">
                ⚠️
              </span>
              <div>
                <div className="jf-banner__title">Manual restart needed</div>
                <div className="jf-banner__sub">
                  Go to Plesk → Node.js → Restart App, then refresh this page.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {updates.length === 0 ? (
        <div className="jf-card">
          <div className="jf-empty">
            <span className="jf-empty__icon" aria-hidden="true">
              ⬆
            </span>
            <span className="jf-empty__title">No remote updates available</span>
            <p>Use the upload above to install a new justflows.zip manually.</p>
          </div>
        </div>
      ) : (
        <div className="jf-card">
          <div className="jf-list">
            {updates.map((item) => (
              <div key={item.id} className="jf-list__row" style={{ alignItems: "center" }}>
                <div className="jf-list__main">
                  <div className="jf-list__title">{item.name}</div>
                  <p className="jf-list__desc">
                    {item.currentVersion} →{" "}
                    <strong style={{ color: "var(--jf-success)" }}>{item.availableVersion}</strong>
                  </p>
                </div>
                <span className="jf-badge jf-badge--info">{item.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {log.length > 0 && (
        <div className="jf-log">
          <p className="jf-log__label">Update log</p>
          {log.map((line, i) => (
            <p key={i} className={`jf-log__line${logVariant(line)}`}>
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
