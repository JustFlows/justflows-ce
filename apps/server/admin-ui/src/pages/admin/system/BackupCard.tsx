// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";
import { useT } from "../../../i18n/I18nProvider";

interface BackupDestinations {
  ftp: {
    enabled: boolean;
    host: string;
    port: number;
    username: string;
    password?: string;
    passwordSet?: boolean;
    remotePath: string;
    secure: boolean;
  };
  email: { enabled: boolean; to: string };
  s3: {
    enabled: boolean;
    bucket: string;
    region: string;
    endpoint: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    accessKeySet?: boolean;
    secretKeySet?: boolean;
    prefix: string;
    forcePathStyle: boolean;
  };
}

interface BackupSchedule {
  enabled: boolean;
  frequency: "daily" | "weekly" | "monthly";
  timeUtc: string;
  weekday: number;
  dayOfMonth: number;
  scope: "root" | "subsites" | "all" | "network";
  destination: "ftp" | "email" | "s3";
  nextRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  passphraseSet: boolean;
}


interface DatabaseSummary {
  driver: string;
  host: string;
  port: number;
  database: string;
  username: string;
}

interface BackupSiteSummary {
  siteId: string;
  siteName: string;
  root: boolean;
  hostnames: Array<{ hostname: string; primary: boolean; kind: string }>;
  records: number;
  users: number;
  mediaFiles: number;
  mediaBytes: number;
  privateFiles: number;
  pluginRows: number;
  undecryptableSecrets: number;
  database: DatabaseSummary | null;
  pluginDatabases: Array<DatabaseSummary & { pluginId: string }>;
}

interface BackupValidation {
  legacy: boolean;
  summary: {
    kind: "site" | "network";
    createdAt: string;
    source: { siteId: string; siteName: string; databaseDriver: string; coreVersion?: string };
    sites: BackupSiteSummary[];
    packages: Array<{ type: string; id: string; version: string; source: string; signed: boolean }>;
  };
  target: { clean: boolean; existingSubsites: number; multisite: boolean } | null;
  restoreAvailable: boolean;
  restoreBlockedReason: "notRoot" | "notClean" | "multisiteOff" | "notOperator" | null;
}

interface Connection {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

type SiteDatabaseChoice = { mode: "workspace" } | { mode: "backup" } | { mode: "custom"; connection: Connection };
type PluginDatabaseChoice = { mode: "backup" } | { mode: "site" } | { mode: "custom"; connection: Connection & { driver: string } };

interface JobStatus {
  status?: "running" | "ready" | "done" | "failed" | "cancelled";
  progress?: number;
  message?: string;
  error?: string;
  files?: Array<{ index: number; siteId: string; siteName: string; filename: string }>;
  result?: { sites?: unknown[] };
}

const MIN_PASSPHRASE = 12;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll a backup or restore job until it finishes; the job lives on the server, so any worker can answer. */
async function followJob(
  jobId: string,
  onProgress: (status: JobStatus) => void,
  cancelled: () => boolean,
): Promise<JobStatus> {
  for (;;) {
    await wait(1000);
    if (cancelled()) return { status: "cancelled" };
    const response = await fetch(`/api/backups/jobs/${jobId}`);
    const status = (await response.json()) as JobStatus;
    if (!response.ok) throw new Error(status.error ?? "Job not found");
    onProgress(status);
    if (status.status && status.status !== "running") return status;
  }
}

function ConnectionFields({
  value,
  onChange,
  idPrefix,
  withDriver,
}: {
  value: Connection & { driver?: string };
  onChange: (value: Connection & { driver?: string }) => void;
  idPrefix: string;
  withDriver?: boolean;
}) {
  const { t } = useT();
  const field = (key: "host" | "database" | "username" | "password", label: string, type = "text") => (
    <input
      id={`${idPrefix}-${key}`}
      className="jf-input"
      aria-label={label}
      placeholder={label}
      type={type}
      autoComplete={type === "password" ? "new-password" : "off"}
      value={value[key]}
      onChange={(event) => onChange({ ...value, [key]: event.target.value })}
    />
  );
  return (
    <div className="jf-row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
      {withDriver && (
        <select
          className="jf-input"
          aria-label={t("tools.backup.dbDriver")}
          value={value.driver ?? "postgres"}
          onChange={(event) => onChange({ ...value, driver: event.target.value })}
        >
          <option value="postgres">PostgreSQL</option>
          <option value="mysql">MySQL</option>
          <option value="mariadb">MariaDB</option>
        </select>
      )}
      {field("host", t("tools.backup.dbHost"))}
      <input
        className="jf-input"
        type="number"
        min={1}
        max={65535}
        aria-label={t("tools.backup.dbPort")}
        placeholder={t("tools.backup.dbPort")}
        value={value.port}
        onChange={(event) => onChange({ ...value, port: Number(event.target.value) })}
      />
      {field("database", t("tools.backup.dbName"))}
      {field("username", t("tools.backup.dbUser"))}
      {field("password", t("tools.backup.password"), "password")}
    </div>
  );
}

export function BackupCard({ installationRoot }: { installationRoot: boolean }) {
  const { t } = useT();
  const backupFileRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const [backupCreating, setBackupCreating] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupValidating, setBackupValidating] = useState(false);
  const [validation, setValidation] = useState<BackupValidation | null>(null);
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [backupRestoring, setBackupRestoring] = useState(false);
  const [restoredCount, setRestoredCount] = useState<number | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [backupMessage, setBackupMessage] = useState("");
  const [backupDestination, setBackupDestination] = useState<"local" | "ftp" | "email" | "s3">("local");
  const [backupDestinations, setBackupDestinations] = useState<BackupDestinations | null>(null);
  const [backupDestinationsSaving, setBackupDestinationsSaving] = useState(false);
  const [backupDelivered, setBackupDelivered] = useState<string | null>(null);
  const [backupScope, setBackupScope] = useState<"site" | "subsites" | "network">("site");
  const [passphrase, setPassphrase] = useState("");
  const [passphraseRepeat, setPassphraseRepeat] = useState("");
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [schedulePassphrase, setSchedulePassphrase] = useState("");
  const [restoreTargets, setRestoreTargets] = useState<Array<{ id: string; name: string; root: boolean }>>([]);
  const [restoreTargetId, setRestoreTargetId] = useState("");
  const [hostnames, setHostnames] = useState<Record<string, Array<{ hostname: string; primary: boolean; include: boolean }>>>({});
  const [siteDatabases, setSiteDatabases] = useState<Record<string, SiteDatabaseChoice>>({});
  const [pluginDatabases, setPluginDatabases] = useState<Record<string, Record<string, PluginDatabaseChoice>>>({});
  const [backupReadyFiles, setBackupReadyFiles] = useState<{
    jobId: string;
    files: Array<{ index: number; siteId: string; siteName: string; filename: string }>;
  } | null>(null);
  const [backupSchedule, setBackupSchedule] = useState<BackupSchedule | null>(null);
  const [backupScheduleSaving, setBackupScheduleSaving] = useState(false);
  const network = validation?.summary.kind === "network";
  const restorePhrase = network ? t("tools.backup.networkConfirmationPhrase") : t("tools.backup.confirmationPhrase");
  const passphraseProblem =
    passphrase.length < MIN_PASSPHRASE
      ? t("tools.backup.passphraseTooShort", { count: MIN_PASSPHRASE })
      : passphrase !== passphraseRepeat
        ? t("tools.backup.passphraseMismatch")
        : null;

  useEffect(() => {
    void fetch("/api/backups/destinations").then(async (response) => {
      if (response.ok) setBackupDestinations((await response.json()) as BackupDestinations);
    });
    void fetch("/api/backups/restore-targets").then(async (response) => {
      if (!response.ok) return;
      const body = (await response.json()) as { sites: Array<{ id: string; name: string; root: boolean }> };
      setRestoreTargets(body.sites);
      setRestoreTargetId(body.sites[0]?.id ?? "");
    });
    if (installationRoot) {
      void fetch("/api/backups/schedule").then(async (response) => {
        if (response.ok) setBackupSchedule((await response.json()) as BackupSchedule);
      });
    }
  }, [installationRoot]);

  async function downloadBackupFile(id: string, file: { index: number; filename: string }) {
    const res = await fetch(`/api/backups/jobs/${id}/download/${file.index}`);
    if (!res.ok) throw new Error(t("tools.backup.createFailed"));
    const url = URL.createObjectURL(await res.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function createBackup() {
    if (passphraseProblem) return;
    setBackupCreating(true);
    setBackupError(null);
    setProgress(0);
    setBackupDelivered(null);
    setBackupReadyFiles(null);
    cancelRef.current = false;
    try {
      const start = await fetch("/api/backups/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: backupScope, passphrase }),
      });
      const started = (await start.json()) as { jobId?: string; error?: string };
      if (!start.ok || !started.jobId) throw new Error(started.error ?? t("tools.backup.createFailed"));
      const id = started.jobId;
      setJobId(id);
      const status = await followJob(
        id,
        (current) => {
          setProgress(current.progress ?? 0);
          setBackupMessage(current.message ?? "");
        },
        () => cancelRef.current,
      );
      if (status.status === "cancelled") throw new Error(t("tools.backup.cancelled"));
      if (status.status !== "ready") throw new Error(status.error ?? t("tools.backup.createFailed"));
      if (backupDestination !== "local") {
        const response = await fetch(`/api/backups/jobs/${id}/deliver`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ destination: backupDestination }),
        });
        const delivered = (await response.json()) as { location?: string; error?: string };
        if (!response.ok) throw new Error(delivered.error ?? t("tools.backup.deliveryFailed"));
        setBackupDelivered(delivered.location ?? backupDestination);
        await fetch(`/api/backups/jobs/${id}`, { method: "DELETE" });
        return;
      }
      const files = status.files ?? [];
      if (files.length > 1) {
        setBackupReadyFiles({ jobId: id, files });
        return;
      }
      const file = files[0];
      if (!file) throw new Error(t("tools.backup.createFailed"));
      await downloadBackupFile(id, file);
      await fetch(`/api/backups/jobs/${id}`, { method: "DELETE" });
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error));
    } finally {
      setBackupCreating(false);
      setJobId(null);
    }
  }

  async function cancelJob() {
    cancelRef.current = true;
    if (jobId) await fetch(`/api/backups/jobs/${jobId}`, { method: "DELETE" });
    setBackupMessage(t("tools.backup.cancelling"));
  }

  async function saveBackupDestinations() {
    if (!backupDestinations) return;
    setBackupDestinationsSaving(true);
    setBackupError(null);
    try {
      const response = await fetch("/api/backups/destinations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(backupDestinations),
      });
      const body = (await response.json()) as { settings?: BackupDestinations; error?: string };
      if (!response.ok || !body.settings) throw new Error(body.error ?? t("tools.backup.settingsFailed"));
      setBackupDestinations(body.settings);
      setBackupMessage(t("tools.backup.settingsSaved"));
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error));
    } finally {
      setBackupDestinationsSaving(false);
    }
  }

  async function saveBackupSchedule() {
    if (!backupSchedule) return;
    setBackupScheduleSaving(true);
    setBackupError(null);
    try {
      const { passphraseSet: _set, nextRunAt: _next, lastStatus: _status, lastError: _error, ...settings } = backupSchedule;
      const response = await fetch("/api/backups/schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, ...(schedulePassphrase ? { passphrase: schedulePassphrase } : {}) }),
      });
      const body = (await response.json()) as BackupSchedule & { error?: string };
      if (!response.ok) throw new Error(body.error ?? t("tools.backup.scheduleSaveFailed"));
      setBackupSchedule(body);
      setSchedulePassphrase("");
      setBackupMessage(t("tools.backup.scheduleSaved"));
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error));
    } finally {
      setBackupScheduleSaving(false);
    }
  }

  async function runBackupScheduleNow() {
    setBackupScheduleSaving(true);
    setBackupError(null);
    try {
      const response = await fetch("/api/backups/schedule/run-now", { method: "POST" });
      const body = (await response.json()) as { jobId?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? t("tools.backup.scheduleRunFailed"));
      setBackupMessage(t("tools.backup.scheduleQueued", { job: body.jobId ?? "" }));
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error));
    } finally {
      setBackupScheduleSaving(false);
    }
  }

  function prepareChoices(result: BackupValidation) {
    const hosts: typeof hostnames = {};
    const databases: Record<string, SiteDatabaseChoice> = {};
    const plugins: typeof pluginDatabases = {};
    for (const site of result.summary.sites) {
      hosts[site.siteId] = site.root
        ? site.hostnames.map((host) => ({ hostname: host.hostname, primary: false, include: false }))
        : site.hostnames.length > 0
          ? site.hostnames.map((host) => ({ hostname: host.hostname, primary: host.primary, include: true }))
          : [{ hostname: "", primary: true, include: true }];
      if (!site.root) databases[site.siteId] = site.database ? { mode: "backup" } : { mode: "workspace" };
      if (site.pluginDatabases.length > 0) {
        plugins[site.siteId] = Object.fromEntries(site.pluginDatabases.map((item) => [item.pluginId, { mode: "backup" } as PluginDatabaseChoice]));
      }
    }
    setHostnames(hosts);
    setSiteDatabases(databases);
    setPluginDatabases(plugins);
  }

  async function validateBackup(file: File) {
    setBackupValidating(true);
    setBackupError(null);
    setValidation(null);
    setBackupFile(null);
    setRestoredCount(null);
    try {
      const form = new FormData();
      form.append("passphrase", restorePassphrase);
      form.append("file", file);
      const res = await fetch("/api/backups/validate", { method: "POST", body: form });
      const body = (await res.json()) as BackupValidation & { error?: string };
      if (!res.ok) throw new Error(body.error ?? t("tools.backup.validateFailed"));
      prepareChoices(body);
      setValidation(body);
      setConfirmation("");
      setBackupFile(file);
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error));
    } finally {
      setBackupValidating(false);
      if (backupFileRef.current) backupFileRef.current.value = "";
    }
  }

  function restorePlan() {
    const plan: Record<string, unknown> = { pluginDatabases };
    if (network) {
      plan.hostnames = Object.fromEntries(
        Object.entries(hostnames).map(([siteId, hosts]) => [
          siteId,
          hosts.filter((host) => host.include && host.hostname.trim()).map((host) => ({ hostname: host.hostname.trim(), primary: host.primary })),
        ]),
      );
      plan.siteDatabases = siteDatabases;
    }
    return plan;
  }

  async function restoreBackup() {
    if (!backupFile || !validation) return;
    setBackupRestoring(true);
    setBackupError(null);
    setRestoredCount(null);
    setProgress(0);
    cancelRef.current = false;
    try {
      const form = new FormData();
      form.append("passphrase", restorePassphrase);
      form.append("confirmation", confirmation);
      form.append("plan", JSON.stringify(restorePlan()));
      if (!network && restoreTargetId) form.append("targetSiteId", restoreTargetId);
      form.append("file", backupFile);
      const res = await fetch(network ? "/api/backups/network/restore" : "/api/backups/restore", { method: "POST", body: form });
      const started = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok || !started.jobId) throw new Error(started.error ?? t("tools.backup.restoreFailed"));
      setJobId(started.jobId);
      const status = await followJob(
        started.jobId,
        (current) => {
          setProgress(current.progress ?? 0);
          setBackupMessage(current.message ?? "");
        },
        () => false,
      );
      if (status.status !== "done") throw new Error(status.error ?? t("tools.backup.restoreFailed"));
      setRestoredCount(network ? (status.result?.sites?.length ?? 0) : 1);
      setValidation(null);
      setBackupFile(null);
      setConfirmation("");
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error));
    } finally {
      setBackupRestoring(false);
      setJobId(null);
    }
  }

  function updateHost(siteId: string, index: number, patch: Partial<{ hostname: string; primary: boolean; include: boolean }>) {
    setHostnames((current) => ({
      ...current,
      [siteId]: (current[siteId] ?? []).map((host, i) =>
        i === index ? { ...host, ...patch } : patch.primary ? { ...host, primary: false } : host,
      ),
    }));
  }

  function blockedMessage(reason: BackupValidation["restoreBlockedReason"]) {
    if (reason === "notRoot") return t("tools.backup.networkBlockedNotRoot");
    if (reason === "notClean") return t("tools.backup.networkBlockedNotClean", { count: validation?.target?.existingSubsites ?? 0 });
    if (reason === "multisiteOff") return t("tools.backup.networkBlockedMultisite");
    return t("tools.backup.networkBlockedOperator");
  }

  const emptyConnection: Connection = { host: "", port: 5432, database: "", username: "", password: "" };

  return (
    <div className="jf-card">
      <div className="jf-card__head">
        <h2 className="jf-card__title">{t("tools.backup.title")}</h2>
      </div>
      <div className="jf-card__body jf-stack">
        <p className="jf-prose">{t("tools.backup.description")}</p>
        <p className="jf-field__hint">{t("tools.backup.scopeHint")}</p>
        {installationRoot && (
          <div className="jf-field">
            <label className="jf-field__label" htmlFor="backup-scope">
              {t("tools.backup.scope")}
            </label>
            <select
              id="backup-scope"
              className="jf-input"
              value={backupScope}
              onChange={(event) => setBackupScope(event.target.value as typeof backupScope)}
            >
              <option value="site">{t("tools.backup.scopeRoot")}</option>
              <option value="subsites">{t("tools.backup.scopeSubsites")}</option>
              <option value="network">{t("tools.backup.scopeNetwork")}</option>
            </select>
            {backupScope === "subsites" && <p className="jf-field__hint">{t("tools.backup.scopeSubsitesHint")}</p>}
            {backupScope === "network" && <p className="jf-field__hint">{t("tools.backup.scopeNetworkHint")}</p>}
          </div>
        )}
        <div className="jf-field">
          <label className="jf-field__label" htmlFor="backup-passphrase">
            {t("tools.backup.passphrase")}
          </label>
          <div className="jf-row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            <input
              id="backup-passphrase"
              className="jf-input"
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
            <input
              className="jf-input"
              type="password"
              autoComplete="new-password"
              aria-label={t("tools.backup.passphraseRepeat")}
              placeholder={t("tools.backup.passphraseRepeat")}
              value={passphraseRepeat}
              onChange={(event) => setPassphraseRepeat(event.target.value)}
            />
          </div>
          <p className="jf-field__hint">{t("tools.backup.passphraseHint")}</p>
          {passphrase && passphraseProblem && <p className="jf-field__hint">{passphraseProblem}</p>}
        </div>
        {backupError && (
          <div className="jf-alert jf-alert--error" role="alert">
            {backupError}
          </div>
        )}
        {restoredCount !== null && (
          <div className="jf-alert jf-alert--success" role="status">
            {network || restoredCount > 1
              ? t("tools.backup.networkRestoreComplete", { count: restoredCount })
              : t("tools.backup.restoreComplete")}
          </div>
        )}
        {backupDelivered && (
          <div className="jf-alert jf-alert--success" role="status">
            {t("tools.backup.delivered", { location: backupDelivered })}
          </div>
        )}
        {backupReadyFiles && (
          <div className="jf-alert jf-alert--success" role="status">
            <strong>{t("tools.backup.filesReady")}</strong>
            <div className="jf-row" style={{ flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}>
              {backupReadyFiles.files.map((file) => (
                <button
                  key={file.siteId}
                  type="button"
                  className="jf-btn jf-btn--secondary"
                  onClick={() =>
                    void downloadBackupFile(backupReadyFiles.jobId, file).catch((error) =>
                      setBackupError(error instanceof Error ? error.message : String(error)),
                    )
                  }
                >
                  {t("tools.backup.downloadFile", { site: file.siteName })}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="jf-field">
          <label className="jf-field__label" htmlFor="backup-destination">
            {t("tools.backup.destination")}
          </label>
          <select
            id="backup-destination"
            className="jf-input"
            value={backupDestination}
            onChange={(event) => setBackupDestination(event.target.value as typeof backupDestination)}
          >
            <option value="local">{t("tools.backup.destinationLocal")}</option>
            <option value="ftp">{t("tools.backup.destinationFtp")}</option>
            <option value="email">{t("tools.backup.destinationEmail")}</option>
            <option value="s3">{t("tools.backup.destinationS3")}</option>
          </select>
        </div>
        <div className="jf-row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          <button
            type="button"
            className="jf-btn jf-btn--primary"
            onClick={() => void createBackup()}
            disabled={backupCreating || backupRestoring || Boolean(passphraseProblem)}
          >
            {backupCreating ? t("tools.backup.creating") : t("tools.backup.download")}
          </button>
          {backupCreating && (
            <button type="button" className="jf-btn jf-btn--ghost" onClick={() => void cancelJob()}>
              {t("tools.backup.cancel")}
            </button>
          )}
        </div>
        {(backupCreating || backupRestoring) && (
          <div role="status" aria-live="polite">
            <progress max={100} value={progress} style={{ width: "100%" }} />
            <p className="jf-field__hint">{backupMessage}</p>
          </div>
        )}

        <h3 className="jf-field__label">{t("tools.backup.restoreTitle")}</h3>
        <div className="jf-field">
          <label className="jf-field__label" htmlFor="backup-restore-passphrase">
            {t("tools.backup.restorePassphrase")}
          </label>
          <input
            id="backup-restore-passphrase"
            className="jf-input"
            type="password"
            autoComplete="off"
            value={restorePassphrase}
            onChange={(event) => setRestorePassphrase(event.target.value)}
          />
          <p className="jf-field__hint">{t("tools.backup.restorePassphraseHint")}</p>
        </div>
        <div className="jf-row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          <input
            ref={backupFileRef}
            type="file"
            accept=".jfbackup,application/vnd.justflows.backup"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void validateBackup(file);
            }}
          />
          <button
            type="button"
            className="jf-btn jf-btn--secondary"
            onClick={() => backupFileRef.current?.click()}
            disabled={backupValidating || backupRestoring}
          >
            {backupValidating ? t("tools.backup.validating") : t("tools.backup.validate")}
          </button>
        </div>
          {backupDestinations && (
            <details>
              <summary className="jf-field__label" style={{ cursor: "pointer" }}>
                {t("tools.backup.destinationSettings")}
              </summary>
              <div className="jf-stack" style={{ marginTop: "0.75rem" }}>
                <label className="jf-checkrow">
                  <input
                    type="checkbox"
                    checked={backupDestinations.ftp.enabled}
                    onChange={(event) =>
                      setBackupDestinations({
                        ...backupDestinations,
                        ftp: { ...backupDestinations.ftp, enabled: event.target.checked },
                      })
                    }
                  />
                  <span>{t("tools.backup.enableFtp")}</span>
                </label>
                <div className="jf-grid jf-grid--2">
                  <input
                    className="jf-input"
                    aria-label={t("tools.backup.ftpHost")}
                    placeholder={t("tools.backup.ftpHost")}
                    value={backupDestinations.ftp.host}
                    onChange={(event) =>
                      setBackupDestinations({
                        ...backupDestinations,
                        ftp: { ...backupDestinations.ftp, host: event.target.value },
                      })
                    }
                  />
                  <input
                    className="jf-input"
                    type="number"
                    min={1}
                    max={65535}
                    aria-label={t("tools.backup.ftpPort")}
                    placeholder={t("tools.backup.ftpPort")}
                    value={backupDestinations.ftp.port}
                    onChange={(event) =>
                      setBackupDestinations({
                        ...backupDestinations,
                        ftp: { ...backupDestinations.ftp, port: Number(event.target.value) },
                      })
                    }
                  />
                  <input
                    className="jf-input"
                    aria-label={t("tools.backup.ftpUser")}
                    placeholder={t("tools.backup.ftpUser")}
                    value={backupDestinations.ftp.username}
                    onChange={(event) =>
                      setBackupDestinations({
                        ...backupDestinations,
                        ftp: { ...backupDestinations.ftp, username: event.target.value },
                      })
                    }
                  />
                  <input
                    className="jf-input"
                    type="password"
                    aria-label={t("tools.backup.password")}
                    placeholder={
                      backupDestinations.ftp.passwordSet
                        ? t("tools.backup.secretSaved")
                        : t("tools.backup.password")
                    }
                    value={backupDestinations.ftp.password ?? ""}
                    onChange={(event) =>
                      setBackupDestinations({
                        ...backupDestinations,
                        ftp: { ...backupDestinations.ftp, password: event.target.value },
                      })
                    }
                  />
                  <input
                    className="jf-input"
                    aria-label={t("tools.backup.remotePath")}
                    placeholder={t("tools.backup.remotePath")}
                    value={backupDestinations.ftp.remotePath}
                    onChange={(event) =>
                      setBackupDestinations({
                        ...backupDestinations,
                        ftp: { ...backupDestinations.ftp, remotePath: event.target.value },
                      })
                    }
                  />
                </div>
                <label className="jf-checkrow">
                  <input
                    type="checkbox"
                    checked={backupDestinations.ftp.secure}
                    onChange={(event) =>
                      setBackupDestinations({
                        ...backupDestinations,
                        ftp: { ...backupDestinations.ftp, secure: event.target.checked },
                      })
                    }
                  />
                  <span>{t("tools.backup.secureFtp")}</span>
                </label>
                <label className="jf-checkrow">
                  <input
                    type="checkbox"
                    checked={backupDestinations.email.enabled}
                    onChange={(event) =>
                      setBackupDestinations({
                        ...backupDestinations,
                        email: { ...backupDestinations.email, enabled: event.target.checked },
                      })
                    }
                  />
                  <span>{t("tools.backup.enableEmail")}</span>
                </label>
                <input
                  className="jf-input"
                  type="email"
                  aria-label={t("tools.backup.emailAddress")}
                  placeholder={t("tools.backup.emailAddress")}
                  value={backupDestinations.email.to}
                  onChange={(event) =>
                    setBackupDestinations({
                      ...backupDestinations,
                      email: { ...backupDestinations.email, to: event.target.value },
                    })
                  }
                />
                <label className="jf-checkrow">
                  <input
                    type="checkbox"
                    checked={backupDestinations.s3.enabled}
                    onChange={(event) =>
                      setBackupDestinations({
                        ...backupDestinations,
                        s3: { ...backupDestinations.s3, enabled: event.target.checked },
                      })
                    }
                  />
                  <span>{t("tools.backup.enableS3")}</span>
                </label>
                <div className="jf-grid jf-grid--2">
                  <input
                    className="jf-input"
                    aria-label={t("tools.backup.s3Bucket")}
                    placeholder={t("tools.backup.s3Bucket")}
                    value={backupDestinations.s3.bucket}
                    onChange={(event) =>
                      setBackupDestinations({
                        ...backupDestinations,
                        s3: { ...backupDestinations.s3, bucket: event.target.value },
                      })
                    }
                  />
                  <input
                    className="jf-input"
                    aria-label={t("tools.backup.s3Region")}
                    placeholder={t("tools.backup.s3Region")}
                    value={backupDestinations.s3.region}
                    onChange={(event) =>
                      setBackupDestinations({
                        ...backupDestinations,
                        s3: { ...backupDestinations.s3, region: event.target.value },
                      })
                    }
                  />
                  <input
                    className="jf-input"
                    aria-label={t("tools.backup.s3Endpoint")}
                    placeholder={t("tools.backup.s3Endpoint")}
                    value={backupDestinations.s3.endpoint}
                    onChange={(event) =>
                      setBackupDestinations({
                        ...backupDestinations,
                        s3: { ...backupDestinations.s3, endpoint: event.target.value },
                      })
                    }
                  />
                  <input
                    className="jf-input"
                    aria-label={t("tools.backup.s3Prefix")}
                    placeholder={t("tools.backup.s3Prefix")}
                    value={backupDestinations.s3.prefix}
                    onChange={(event) =>
                      setBackupDestinations({
                        ...backupDestinations,
                        s3: { ...backupDestinations.s3, prefix: event.target.value },
                      })
                    }
                  />
                  <input
                    className="jf-input"
                    aria-label={t("tools.backup.accessKey")}
                    placeholder={
                      backupDestinations.s3.accessKeySet
                        ? t("tools.backup.secretSaved")
                        : t("tools.backup.accessKey")
                    }
                    value={backupDestinations.s3.accessKeyId ?? ""}
                    onChange={(event) =>
                      setBackupDestinations({
                        ...backupDestinations,
                        s3: { ...backupDestinations.s3, accessKeyId: event.target.value },
                      })
                    }
                  />
                  <input
                    className="jf-input"
                    type="password"
                    aria-label={t("tools.backup.secretKey")}
                    placeholder={
                      backupDestinations.s3.secretKeySet
                        ? t("tools.backup.secretSaved")
                        : t("tools.backup.secretKey")
                    }
                    value={backupDestinations.s3.secretAccessKey ?? ""}
                    onChange={(event) =>
                      setBackupDestinations({
                        ...backupDestinations,
                        s3: { ...backupDestinations.s3, secretAccessKey: event.target.value },
                      })
                    }
                  />
                </div>
                <label className="jf-checkrow">
                  <input
                    type="checkbox"
                    checked={backupDestinations.s3.forcePathStyle}
                    onChange={(event) =>
                      setBackupDestinations({
                        ...backupDestinations,
                        s3: { ...backupDestinations.s3, forcePathStyle: event.target.checked },
                      })
                    }
                  />
                  <span>{t("tools.backup.s3PathStyle")}</span>
                </label>
                <button
                  type="button"
                  className="jf-btn jf-btn--secondary"
                  disabled={backupDestinationsSaving}
                  onClick={saveBackupDestinations}
                >
                  {backupDestinationsSaving
                    ? t("tools.backup.savingSettings")
                    : t("tools.backup.saveSettings")}
                </button>
              </div>
            </details>
          )}
          {installationRoot && backupSchedule && (
            <details open={backupSchedule.enabled}>
              <summary className="jf-field__label" style={{ cursor: "pointer" }}>
                {t("tools.backup.scheduleTitle")}
              </summary>
              <div className="jf-stack" style={{ marginTop: "0.75rem" }}>
                <label className="jf-checkrow">
                  <input
                    type="checkbox"
                    checked={backupSchedule.enabled}
                    onChange={(event) =>
                      setBackupSchedule({ ...backupSchedule, enabled: event.target.checked })
                    }
                  />
                  <span>{t("tools.backup.scheduleEnable")}</span>
                </label>
                <div className="jf-grid jf-grid--2">
                  <label className="jf-field">
                    <span className="jf-field__label">{t("tools.backup.scheduleFrequency")}</span>
                    <select className="jf-input" value={backupSchedule.frequency} onChange={(event) => setBackupSchedule({ ...backupSchedule, frequency: event.target.value as BackupSchedule["frequency"] })}>
                      <option value="daily">{t("tools.backup.scheduleDaily")}</option>
                      <option value="weekly">{t("tools.backup.scheduleWeekly")}</option>
                      <option value="monthly">{t("tools.backup.scheduleMonthly")}</option>
                    </select>
                  </label>
                  <label className="jf-field">
                    <span className="jf-field__label">{t("tools.backup.scheduleTimeUtc")}</span>
                    <input className="jf-input" type="time" value={backupSchedule.timeUtc} onChange={(event) => setBackupSchedule({ ...backupSchedule, timeUtc: event.target.value })} />
                  </label>
                  {backupSchedule.frequency === "weekly" && (
                    <label className="jf-field">
                      <span className="jf-field__label">{t("tools.backup.scheduleWeekday")}</span>
                      <select className="jf-input" value={backupSchedule.weekday} onChange={(event) => setBackupSchedule({ ...backupSchedule, weekday: Number(event.target.value) })}>
                        {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => <option key={day} value={index}>{day}</option>)}
                      </select>
                    </label>
                  )}
                  {backupSchedule.frequency === "monthly" && (
                    <label className="jf-field">
                      <span className="jf-field__label">{t("tools.backup.scheduleDayOfMonth")}</span>
                      <input className="jf-input" type="number" min={1} max={31} value={backupSchedule.dayOfMonth} onChange={(event) => setBackupSchedule({ ...backupSchedule, dayOfMonth: Number(event.target.value) })} />
                    </label>
                  )}
                  <label className="jf-field">
                    <span className="jf-field__label">{t("tools.backup.scheduleScope")}</span>
                    <select className="jf-input" value={backupSchedule.scope} onChange={(event) => setBackupSchedule({ ...backupSchedule, scope: event.target.value as BackupSchedule["scope"] })}>
                      <option value="root">{t("tools.backup.scopeRoot")}</option>
                      <option value="subsites">{t("tools.backup.scopeSubsites")}</option>
                      <option value="all">{t("tools.backup.scheduleAllSites")}</option>
                      <option value="network">{t("tools.backup.scopeNetwork")}</option>
                    </select>
                  </label>
                  <label className="jf-field">
                    <span className="jf-field__label">{t("tools.backup.destination")}</span>
                    <select className="jf-input" value={backupSchedule.destination} onChange={(event) => setBackupSchedule({ ...backupSchedule, destination: event.target.value as BackupSchedule["destination"] })}>
                      <option value="ftp">{t("tools.backup.destinationFtp")}</option>
                      <option value="email">{t("tools.backup.destinationEmail")}</option>
                      <option value="s3">{t("tools.backup.destinationS3")}</option>
                    </select>
                  </label>
                </div>
                <label className="jf-field">
                  <span className="jf-field__label">{t("tools.backup.schedulePassphrase")}</span>
                  <input
                    className="jf-input"
                    type="password"
                    autoComplete="new-password"
                    value={schedulePassphrase}
                    onChange={(event) => setSchedulePassphrase(event.target.value)}
                    placeholder={backupSchedule.passphraseSet ? t("tools.backup.secretSaved") : ""}
                  />
                  <span className="jf-field__hint">{t("tools.backup.schedulePassphraseHint")}</span>
                </label>
                <p className="jf-field__hint">
                  {backupSchedule.nextRunAt ? t("tools.backup.scheduleNext", { date: new Date(backupSchedule.nextRunAt).toLocaleString() }) : t("tools.backup.scheduleNoNext")}
                  {backupSchedule.lastStatus ? ` · ${t("tools.backup.scheduleLast", { status: backupSchedule.lastStatus })}` : ""}
                </p>
                {backupSchedule.lastError && <div className="jf-alert jf-alert--error" role="alert">{backupSchedule.lastError}</div>}
                <div className="jf-row">
                  <button type="button" className="jf-btn jf-btn--primary" disabled={backupScheduleSaving} onClick={() => void saveBackupSchedule()}>{t("tools.backup.scheduleSave")}</button>
                  <button type="button" className="jf-btn jf-btn--secondary" disabled={backupScheduleSaving} onClick={() => void runBackupScheduleNow()}>{t("tools.backup.scheduleRunNow")}</button>
                </div>
              </div>
            </details>
          )}

        {validation && (
          <div className="jf-alert jf-alert--success" role="status">
            {/** The alert lays its children out in a row; keep the review panel stacked. */}
            <div className="jf-stack" style={{ flex: 1, minWidth: 0 }}>
            <strong>{network ? t("tools.backup.networkValidTitle") : t("tools.backup.validTitle")}</strong>{" "}
            {t("tools.backup.networkSummary", {
              site: validation.summary.source.siteName,
              date: new Date(validation.summary.createdAt).toLocaleString(),
              count: validation.summary.sites.length,
            })}
            {validation.legacy && <p className="jf-field__hint">{t("tools.backup.legacyHint")}</p>}
            {validation.summary.packages.length > 0 && (
              <p className="jf-field__hint">
                {t("tools.backup.packagesSummary", {
                  list: validation.summary.packages
                    .map((item) => `${item.id} ${item.version}${item.signed ? "" : ` (${t("tools.backup.unsigned")})`}`)
                    .join(", "),
                })}
              </p>
            )}
            <ul className="jf-stack" style={{ listStyle: "none", padding: 0 }}>
              {validation.summary.sites.map((site) => (
                <li key={site.siteId} className="jf-field">
                  <span className="jf-field__label">
                    {site.siteName} ({site.root ? t("tools.backup.rootSite") : t("tools.backup.subsite")})
                  </span>
                  <p className="jf-field__hint">
                    {t("tools.backup.networkRecords", { count: site.records })} ·{" "}
                    {t("tools.backup.usersSummary", { count: site.users })} ·{" "}
                    {t("tools.backup.mediaSummary", { count: site.mediaFiles, size: formatBytes(site.mediaBytes) })}
                    {site.pluginRows > 0 ? ` · ${t("tools.backup.pluginRowsSummary", { count: site.pluginRows })}` : ""}
                  </p>
                  {site.undecryptableSecrets > 0 && (
                    <p className="jf-field__hint">{t("tools.backup.undecryptableSecrets", { count: site.undecryptableSecrets })}</p>
                  )}
                  {network &&
                    (hostnames[site.siteId] ?? []).map((host, index) => (
                      <div key={index} className="jf-row" style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                        <label className="jf-checkrow">
                          <input
                            type="checkbox"
                            checked={host.include}
                            disabled={!site.root && host.primary}
                            onChange={(event) => updateHost(site.siteId, index, { include: event.target.checked })}
                          />
                          <span>{site.root ? t("tools.backup.addAddress") : host.primary ? t("tools.backup.primaryAddress") : t("tools.backup.extraAddress")}</span>
                        </label>
                        <input
                          className="jf-input"
                          aria-label={t("tools.backup.networkHostname", { site: site.siteName })}
                          value={host.hostname}
                          onChange={(event) => updateHost(site.siteId, index, { hostname: event.target.value })}
                          autoComplete="off"
                          spellCheck={false}
                          disabled={backupRestoring}
                        />
                      </div>
                    ))}
                  {network && site.root && <p className="jf-field__hint">{t("tools.backup.networkRootHostnameHint")}</p>}
                  {network && !site.root && (
                    <div className="jf-field">
                      <label className="jf-field__label" htmlFor={`db-${site.siteId}`}>
                        {t("tools.backup.siteDatabase")}
                      </label>
                      <select
                        id={`db-${site.siteId}`}
                        className="jf-input"
                        value={siteDatabases[site.siteId]?.mode ?? "workspace"}
                        onChange={(event) => {
                          const mode = event.target.value as SiteDatabaseChoice["mode"];
                          setSiteDatabases({
                            ...siteDatabases,
                            [site.siteId]: mode === "custom" ? { mode, connection: { ...emptyConnection, ...(site.database ?? {}), password: "" } } : { mode },
                          });
                        }}
                      >
                        <option value="workspace">{t("tools.backup.dbWorkspace")}</option>
                        {site.database && (
                          <option value="backup">
                            {t("tools.backup.dbFromBackup", { target: `${site.database.username}@${site.database.host}:${site.database.port}/${site.database.database}` })}
                          </option>
                        )}
                        <option value="custom">{t("tools.backup.dbCustom")}</option>
                      </select>
                      {siteDatabases[site.siteId]?.mode === "custom" && (
                        <ConnectionFields
                          idPrefix={`db-${site.siteId}`}
                          value={(siteDatabases[site.siteId] as { connection: Connection }).connection}
                          onChange={(connection) => setSiteDatabases({ ...siteDatabases, [site.siteId]: { mode: "custom", connection } })}
                        />
                      )}
                    </div>
                  )}
                  {site.pluginDatabases.map((item) => {
                    const choice = pluginDatabases[site.siteId]?.[item.pluginId] ?? { mode: "backup" };
                    const setChoice = (next: PluginDatabaseChoice) =>
                      setPluginDatabases({ ...pluginDatabases, [site.siteId]: { ...(pluginDatabases[site.siteId] ?? {}), [item.pluginId]: next } });
                    return (
                      <div key={item.pluginId} className="jf-field">
                        <label className="jf-field__label" htmlFor={`plugin-db-${site.siteId}-${item.pluginId}`}>
                          {t("tools.backup.pluginDatabase", { plugin: item.pluginId })}
                        </label>
                        <select
                          id={`plugin-db-${site.siteId}-${item.pluginId}`}
                          className="jf-input"
                          value={choice.mode}
                          onChange={(event) => {
                            const mode = event.target.value as PluginDatabaseChoice["mode"];
                            setChoice(mode === "custom" ? { mode, connection: { ...emptyConnection, ...item, password: "" } } : { mode });
                          }}
                        >
                          <option value="backup">
                            {t("tools.backup.dbFromBackup", { target: `${item.username}@${item.host}:${item.port}/${item.database}` })}
                          </option>
                          <option value="site">{t("tools.backup.dbSite")}</option>
                          <option value="custom">{t("tools.backup.dbCustom")}</option>
                        </select>
                        {choice.mode === "custom" && (
                          <ConnectionFields
                            idPrefix={`plugin-db-${site.siteId}-${item.pluginId}`}
                            withDriver
                            value={choice.connection}
                            onChange={(connection) => setChoice({ mode: "custom", connection: { ...connection, driver: connection.driver ?? "postgres" } })}
                          />
                        )}
                      </div>
                    );
                  })}
                </li>
              ))}
            </ul>
            {network && validation.restoreBlockedReason ? (
              <div className="jf-alert jf-alert--warning" role="alert">
                {blockedMessage(validation.restoreBlockedReason)}
              </div>
            ) : (
              <>
                {!network && (
                  <div className="jf-field">
                    <label className="jf-field__label" htmlFor="backup-restore-target">
                      {t("tools.backup.restoreTarget")}
                    </label>
                    <select
                      id="backup-restore-target"
                      className="jf-input"
                      value={restoreTargetId}
                      onChange={(event) => setRestoreTargetId(event.target.value)}
                    >
                      {restoreTargets.map((site) => (
                        <option key={site.id} value={site.id}>
                          {site.name} {site.root ? `(${t("tools.backup.rootSite")})` : `(${t("tools.backup.subsite")})`}
                        </option>
                      ))}
                    </select>
                    <p className="jf-field__hint">{t("tools.backup.restoreReplacesTarget")}</p>
                  </div>
                )}
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="backup-restore-confirmation">
                    {t("tools.backup.confirmLabel", { phrase: restorePhrase })}
                  </label>
                  <input
                    id="backup-restore-confirmation"
                    className="jf-input"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    placeholder={restorePhrase}
                    autoComplete="off"
                    disabled={backupRestoring}
                  />
                  <p className="jf-field__hint">{network ? t("tools.backup.networkRestoreHint") : t("tools.backup.restoreRollbackHint")}</p>
                </div>
                <div className="jf-row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className="jf-btn jf-btn--danger"
                    disabled={backupRestoring || backupCreating || confirmation !== restorePhrase}
                    onClick={() => void restoreBackup()}
                  >
                    {backupRestoring
                      ? network
                        ? t("tools.backup.networkRestoring")
                        : t("tools.backup.restoring")
                      : network
                        ? t("tools.backup.networkRestore")
                        : t("tools.backup.restore")}
                  </button>
                  {backupRestoring && jobId && (
                    <button type="button" className="jf-btn jf-btn--ghost" onClick={() => void cancelJob()}>
                      {t("tools.backup.cancel")}
                    </button>
                  )}
                </div>
              </>
            )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
