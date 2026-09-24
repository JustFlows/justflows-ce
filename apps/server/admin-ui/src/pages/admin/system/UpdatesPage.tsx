import { useEffect, useRef, useState } from "react";
import { initialJson } from "../../../ssr-data";
import { useT } from "../../../i18n/I18nProvider";

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
  notesUrl?: string;
  publishedAt?: string | null;
  autoUpdatable?: boolean;
}

interface AutoUpdateInfo {
  enabled: boolean;
  available: boolean;
  maxScope: string;
}

interface UpdateStatus {
  running: boolean;
  phase: string;
  source: "upload" | "remote" | "auto" | null;
  startedAt: number | null;
  updatedAt: number;
  finishedAt: number | null;
  currentVersion: string | null;
  targetVersion: string | null;
  newVersion: string | null;
  ok: boolean | null;
  error: string | null;
  restartRequired: boolean;
  restarting: boolean;
  steps: UpdateStep[];
  log: string[];
}

interface StartResponse {
  started?: boolean;
  background?: boolean;
  ok?: boolean;
  error?: string;
  steps?: UpdateStep[];
  currentVersion?: string;
  newVersion?: string;
  restartRequired?: boolean;
  restarting?: boolean;
  status?: UpdateStatus;
}

const PHASE_LABEL_KEYS: Record<string, string> = {
  queued: "updates.phase.queued",
  downloading: "updates.phase.downloading",
  verifying: "updates.phase.verifying",
  extracting: "updates.phase.extracting",
  validating: "updates.phase.validating",
  copying: "updates.phase.copyingFiles",
  migrating: "updates.phase.runningMigrations",
  installing: "updates.phase.installingDependencies",
  building: "updates.phase.building",
  restarting: "updates.phase.restarting",
  done: "updates.phase.done",
  failed: "updates.phase.failed",
};

function logVariant(line: string): string {
  if (line.startsWith("✓")) return " jf-log__line--ok";
  if (line.startsWith("✗")) return " jf-log__line--fail";
  if (line.startsWith("⚠")) return " jf-log__line--warn";
  if (line.startsWith("↻")) return " jf-log__line--info";
  return "";
}

/** fetch() with a hard timeout — a wedged server must not hang the UI forever. */
function fetchWithTimeout(input: string, init: RequestInit = {}, ms = 30_000): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(ms) });
}

export default function UpdatesPage() {
  const { t } = useT();
  const prefetched = initialJson<{
    currentVersion?: string;
    version?: string;
    updates?: UpdateItem[];
    autoUpdate?: AutoUpdateInfo;
  }>("/api/updates");
  const [currentVersion, setCurrentVersion] = useState(
    prefetched?.currentVersion ?? prefetched?.version ?? "…",
  );
  const [updates, setUpdates] = useState<UpdateItem[]>(prefetched?.updates ?? []);
  const [autoUpdate, setAutoUpdate] = useState<AutoUpdateInfo>(
    prefetched?.autoUpdate ?? { enabled: false, available: true, maxScope: "minor" },
  );
  const [savingAuto, setSavingAuto] = useState(false);
  const [checking, setChecking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [restartFailed, setRestartFailed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollFailures = useRef(0);

  function phaseLabelFor(p: string): string {
    const key = PHASE_LABEL_KEYS[p];
    return key ? t(key) : p;
  }

  useEffect(() => {
    fetch("/api/updates")
      .then((r) => r.json())
      .then(
        (data: {
          currentVersion?: string;
          updates?: UpdateItem[];
          autoUpdate?: AutoUpdateInfo;
        }) => {
          if (data.currentVersion) setCurrentVersion(data.currentVersion);
          if (data.updates) setUpdates(data.updates);
          if (data.autoUpdate) setAutoUpdate(data.autoUpdate);
        },
      )
      .catch(() => {});

    // Re-attach to an update that is already running (e.g. after a page reload).
    fetch("/api/updates/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((status: UpdateStatus) => {
        if (status.running || status.phase === "restarting") {
          setInstalling(true);
          applyStatus(status);
          startPolling();
        }
      })
      .catch(() => {});

    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopPolling() {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }

  function addLog(line: string) {
    setLog((l) => [...l, line]);
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Render a status snapshot into the log/phase UI. */
  function applyStatus(status: UpdateStatus) {
    setPhase(status.phase);
    if (status.log?.length) setLog(status.log);
    else if (status.steps?.length) {
      setLog(
        status.steps.map((s) => `${s.ok ? "✓" : "✗"} ${s.step}${s.detail ? `: ${s.detail}` : ""}`),
      );
    }
    if (status.newVersion) setCurrentVersion(status.newVersion);
  }

  function finishRun(status: UpdateStatus) {
    stopPolling();
    setInstalling(false);
    setUploading(false);
    if (status.ok && status.restarting) {
      void waitForSiteBack();
    } else if (status.restartRequired) {
      setRestartFailed(true);
      addLog(`⚠ ${t("updates.log.manualRestartNeeded")}`);
    }
  }

  async function pollOnce() {
    try {
      const res = await fetchWithTimeout("/api/updates/status", { cache: "no-store" }, 15_000);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const status = (await res.json()) as UpdateStatus;
      pollFailures.current = 0;
      applyStatus(status);
      if (!status.running && (status.phase === "done" || status.phase === "failed")) {
        finishRun(status);
        return;
      }
    } catch {
      // The app may be mid-restart; keep polling for a while — but not forever.
      pollFailures.current += 1;
      if (pollFailures.current > 120) {
        stopPolling();
        setInstalling(false);
        setUploading(false);
        setRestartFailed(true);
        addLog(`⚠ ${t("updates.log.lostContact")}`);
        return;
      }
    }
    pollTimer.current = setTimeout(() => void pollOnce(), 2500);
  }

  function startPolling() {
    stopPolling();
    pollFailures.current = 0;
    pollTimer.current = setTimeout(() => void pollOnce(), 1500);
  }

  async function checkForUpdates() {
    setChecking(true);
    setLog([]);
    try {
      const res = await fetch("/api/updates", { cache: "no-store" });
      const data = (await res.json()) as {
        updates: UpdateItem[];
        currentVersion?: string;
        autoUpdate?: AutoUpdateInfo;
      };
      setUpdates(data.updates ?? []);
      if (data.currentVersion) setCurrentVersion(data.currentVersion);
      if (data.autoUpdate) setAutoUpdate(data.autoUpdate);
      addLog(
        data.updates?.length
          ? t("updates.log.foundUpdates", { count: data.updates.length })
          : t("updates.log.upToDate"),
      );
    } finally {
      setChecking(false);
    }
  }

  async function waitForSiteBack() {
    setRestarting(true);
    setPhase("restarting");
    addLog(`↻ ${t("updates.log.appRestarting")}`);
    await sleep(4000);

    for (let attempt = 0; attempt < 45; attempt++) {
      try {
        const res = await fetchWithTimeout("/api/install/status", { cache: "no-store" }, 5000);
        if (res.ok) {
          addLog(`✓ ${t("updates.log.siteBack")}`);
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
    addLog(`⚠ ${t("updates.log.restartInProgress")}`);
    setRestarting(false);
  }

  /**
   * Kick off an update. The server either runs it in a detached worker (202 +
   * `background: true`) — we then poll `/api/updates/status` — or, on the one
   * transitional build that predates the worker, runs it inline and returns the
   * full result.
   */
  async function runUpdateFlow(request: Promise<Response>) {
    setRestarting(false);
    setRestartFailed(false);
    setPhase("queued");

    try {
      const res = await request;
      let data: StartResponse;
      try {
        data = (await res.json()) as StartResponse;
      } catch {
        data = {};
      }

      if (res.status === 409) {
        addLog(`⚠ ${data.error ?? t("updates.log.alreadyRunning")}`);
        if (data.status) applyStatus(data.status);
        startPolling();
        return;
      }

      if (data.background) {
        if (data.status) applyStatus(data.status);
        addLog(`↻ ${t("updates.log.runningInBackground")}`);
        startPolling();
        return;
      }

      // Inline (compatibility) result.
      if (data.steps) {
        for (const step of data.steps) {
          addLog(`${step.ok ? "✓" : "✗"} ${step.step}${step.detail ? `: ${step.detail}` : ""}`);
        }
      }
      if (!res.ok || data.ok === false) {
        throw new Error(
          data.error ?? data.steps?.find((s) => !s.ok)?.detail ?? t("updates.log.updateFailed"),
        );
      }
      if (data.newVersion) setCurrentVersion(data.newVersion);
      if (data.restarting) {
        await waitForSiteBack();
      } else if (data.restartRequired) {
        setRestartFailed(true);
        addLog(`⚠ ${t("updates.log.manualRestartNeeded")}`);
      }
      setInstalling(false);
      setUploading(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A dropped connection here usually means the worker is busy or the app is
      // restarting — fall back to polling rather than declaring failure.
      addLog(`⚠ ${t("updates.log.checkingStatus", { message: msg })}`);
      startPolling();
    }
  }

  async function uploadZip(file: File) {
    setUploading(true);
    setInstalling(true);
    setLog([]);
    addLog(t("updates.log.uploading", { file: file.name }));

    const form = new FormData();
    form.append("file", file);
    try {
      // Long timeout: the upload body itself can be large; the pipeline no longer
      // runs inside this request.
      await runUpdateFlow(
        fetchWithTimeout("/api/updates/upload", { method: "POST", body: form }, 10 * 60 * 1000),
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function installRemote(item: UpdateItem) {
    setInstalling(true);
    setLog([]);
    addLog(t("updates.log.startingUpdate", { version: item.availableVersion }));

    await runUpdateFlow(
      fetchWithTimeout(
        "/api/updates/remote",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version: item.availableVersion }),
        },
        2 * 60 * 1000,
      ),
    );
  }

  /**
   * Re-download and reapply whatever the gateway currently publishes as
   * latest, even if it's the version already installed. Repairs a corrupted
   * install (bad copy, interrupted dependency install, a manually edited
   * file) without waiting on a new release — same pipeline as a normal
   * remote update, so it still restarts the site.
   */
  async function forceReinstall() {
    if (!window.confirm(t("updates.forceReinstallConfirm", { version: currentVersion }))) {
      return;
    }
    setInstalling(true);
    setLog([]);
    addLog(t("updates.log.forceReinstalling", { version: currentVersion }));

    await runUpdateFlow(
      fetchWithTimeout(
        "/api/updates/remote",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ force: true }),
        },
        2 * 60 * 1000,
      ),
    );
  }

  async function toggleAutoUpdate(next: boolean) {
    setSavingAuto(true);
    try {
      const res = await fetch("/api/updates/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoUpdate: { enabled: next } }),
      });
      const data = (await res.json()) as { autoUpdate?: AutoUpdateInfo; error?: string };
      if (!res.ok) throw new Error(data.error ?? t("updates.autoUpdate.saveFailed"));
      if (data.autoUpdate) setAutoUpdate(data.autoUpdate);
    } catch (e) {
      addLog(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingAuto(false);
    }
  }

  const busy = uploading || installing || restarting;
  const phaseLabel = phase ? phaseLabelFor(phase) : null;

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("updates.title")}</h1>
          <p>
            {t("updates.currentVersion")} <strong>v{currentVersion}</strong>
          </p>
        </div>
        <div className="jf-pagehead__actions">
          <button
            className="jf-btn jf-btn--ghost"
            onClick={checkForUpdates}
            disabled={checking || busy}
          >
            {checking ? t("updates.checking") : t("updates.checkForUpdates")}
          </button>
          <button
            className="jf-btn jf-btn--ghost"
            onClick={forceReinstall}
            disabled={checking || busy}
            title={t("updates.forceReinstallTitle")}
          >
            {t("updates.forceReinstall")}
          </button>
        </div>
      </header>

      <div className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">{t("updates.upload.title")}</h2>
        </div>
        <div className="jf-card__body jf-stack">
          <p className="jf-prose">
            {t("updates.upload.description1")} <code className="jf-code">justflows.zip</code>{" "}
            {t("updates.upload.description2")} <code className="jf-code">.env</code>{" "}
            {t("updates.upload.description3")}
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
                ? t("updates.upload.uploading")
                : restarting
                  ? t("updates.restarting")
                  : installing
                    ? `${t("updates.updating")} ${phaseLabel ?? ""}`.trim()
                    : t("updates.upload.chooseFile")}
            </button>
            {busy && (
              <span className="jf-meta">
                {restarting
                  ? t("updates.waitingRestart")
                  : t("updates.upload.backgroundHint")}
              </span>
            )}
          </div>

          {restartFailed && (
            <div className="jf-banner jf-banner--warn">
              <span className="jf-banner__icon" aria-hidden="true">
                ⚠️
              </span>
              <div>
                <div className="jf-banner__title">{t("updates.manualRestartTitle")}</div>
                <div className="jf-banner__sub">
                  {t("updates.manualRestartBody")}
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
            <span className="jf-empty__title">{t("updates.empty.title")}</span>
            <p>{t("updates.empty.body")}</p>
          </div>
        </div>
      ) : (
        <div className="jf-card">
          <div className="jf-list">
            {updates.map((item) => (
              <div key={item.id} className="jf-list__row" style={{ alignItems: "center" }}>
                <div className="jf-list__main">
                  <div className="jf-list__title">
                    {item.name}
                    {item.autoUpdatable === false && (
                      <span className="jf-badge jf-badge--warn" style={{ marginLeft: 8 }}>
                        {t("updates.majorBadge")}
                      </span>
                    )}
                  </div>
                  <p className="jf-list__desc">
                    {item.currentVersion} →{" "}
                    <strong style={{ color: "var(--jf-success)" }}>{item.availableVersion}</strong>
                    {item.notesUrl && (
                      <>
                        {" · "}
                        <a href={item.notesUrl} target="_blank" rel="noreferrer">
                          {t("updates.releaseNotes")}
                        </a>
                      </>
                    )}
                  </p>
                  {item.autoUpdatable === false && (
                    <p className="jf-meta">
                      {t("updates.majorVersionWarning")}
                    </p>
                  )}
                </div>
                {item.type === "core" ? (
                  <button
                    className="jf-btn jf-btn--primary"
                    onClick={() => installRemote(item)}
                    disabled={busy || checking}
                  >
                    {installing
                      ? `${t("updates.updating")} ${phaseLabel ?? ""}`.trim()
                      : restarting
                        ? t("updates.restarting")
                        : t("updates.updateToVersion", { version: item.availableVersion })}
                  </button>
                ) : (
                  <span className="jf-badge jf-badge--info">{item.type}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">{t("updates.autoUpdate.title")}</h2>
        </div>
        <div className="jf-card__body jf-stack">
          <label className="jf-row" style={{ alignItems: "center", gap: 10 }}>
            <input
              type="checkbox"
              checked={autoUpdate.enabled}
              disabled={!autoUpdate.available || savingAuto || busy}
              onChange={(e) => toggleAutoUpdate(e.target.checked)}
            />
            <span>
              {t("updates.autoUpdate.checkboxText1")} <code className="jf-code">0.x</code>{" "}
              {t("updates.autoUpdate.checkboxText2")}
            </span>
          </label>
          <p className="jf-prose">
            {t("updates.autoUpdate.description1")}{" "}
            <code className="jf-code">v{currentVersion}</code> {t("updates.autoUpdate.description2")}{" "}
            <code className="jf-code">v0.x.y</code>
            {t("updates.autoUpdate.description3")}
          </p>
          {!autoUpdate.available && (
            <p className="jf-meta">
              {t("updates.autoUpdate.disabledHint1")}
              <code className="jf-code">JUSTFLOWS_DISABLE_AUTO_UPDATE</code>
              {t("updates.autoUpdate.disabledHint2")}
            </p>
          )}
        </div>
      </div>

      {log.length > 0 && (
        <div className="jf-log">
          <p className="jf-log__label">
            {t("updates.logLabel")}{phaseLabel && installing ? ` — ${phaseLabel}` : ""}
          </p>
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
