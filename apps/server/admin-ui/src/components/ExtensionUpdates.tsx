// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n/I18nProvider";

export type ExtensionType = "plugin" | "theme";

export interface ExtensionUpdate {
  type: ExtensionType;
  id: string;
  name: string;
  installedVersion: string;
  availableVersion: string;
  autoUpdatable: boolean;
  autoUpdate: boolean;
  beta: boolean;
}

interface UpdatesReport {
  checkedAt: string;
  updates: ExtensionUpdate[];
  autoUpdate: Record<ExtensionType, string[]>;
  autoUpdateDisabledByOperator: boolean;
}

export interface UpdatedExtension {
  type: ExtensionType;
  id: string;
  previousVersion: string;
  version: string;
  activationError?: string;
}

/**
 * Marketplace update state for installed plugins and themes, shared by the
 * Plugins, Themes, and Marketplace screens. Disabled for non-administrators,
 * who cannot read or apply updates on the server.
 */
export function useExtensionUpdates(enabled: boolean) {
  const { t } = useT();
  const [report, setReport] = useState<UpdatesReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(
    async (force = false) => {
      if (!enabled) return;
      setChecking(true);
      setError("");
      try {
        const res = await fetch(`/api/marketplace/updates${force ? "?force=1" : ""}`);
        const data = (await res.json().catch(() => ({}))) as Partial<UpdatesReport> & { error?: string };
        if (!res.ok) throw new Error(data.error ?? t("extensionUpdates.checkFailed"));
        setReport({
          checkedAt: data.checkedAt ?? new Date().toISOString(),
          updates: Array.isArray(data.updates) ? data.updates : [],
          autoUpdate: {
            plugin: data.autoUpdate?.plugin ?? [],
            theme: data.autoUpdate?.theme ?? [],
          },
          autoUpdateDisabledByOperator: data.autoUpdateDisabledByOperator === true,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setChecking(false);
      }
    },
    [enabled, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const updateFor = useCallback(
    (type: ExtensionType, id: string) =>
      report?.updates.find((u) => u.type === type && u.id === id) ?? null,
    [report],
  );

  const isAutoUpdate = useCallback(
    (type: ExtensionType, id: string) => report?.autoUpdate[type].includes(id) ?? false,
    [report],
  );

  async function applyUpdate(update: ExtensionUpdate): Promise<UpdatedExtension | null> {
    setUpdating(`${update.type}:${update.id}`);
    setError("");
    setNotice("");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 120_000);
    try {
      const res = await fetch("/api/marketplace/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: update.type, id: update.id, version: update.availableVersion }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as Partial<UpdatedExtension> & { error?: string };
      if (!res.ok) throw new Error(data.error ?? t("extensionUpdates.updateFailed"));
      const result = data as UpdatedExtension;
      setReport((prev) =>
        prev
          ? { ...prev, updates: prev.updates.filter((u) => !(u.type === update.type && u.id === update.id)) }
          : prev,
      );
      if (result.activationError) {
        setError(t("extensionUpdates.activationFailed", { name: update.name, error: result.activationError }));
      } else {
        setNotice(t("extensionUpdates.updated", { name: update.name, version: result.version }));
      }
      return result;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError(t("extensionUpdates.updateTimeout"));
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      return null;
    } finally {
      window.clearTimeout(timer);
      setUpdating(null);
    }
  }

  async function setAutoUpdate(type: ExtensionType, id: string, on: boolean): Promise<void> {
    setError("");
    const res = await fetch("/api/marketplace/auto-update", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, id, enabled: on }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      autoUpdate?: Record<ExtensionType, string[]>;
      error?: string;
    };
    if (!res.ok || !data.autoUpdate) {
      setError(data.error ?? t("extensionUpdates.autoUpdateFailed"));
      return;
    }
    const autoUpdate = data.autoUpdate;
    setReport((prev) =>
      prev
        ? {
            ...prev,
            autoUpdate,
            updates: prev.updates.map((u) => ({ ...u, autoUpdate: autoUpdate[u.type].includes(u.id) })),
          }
        : prev,
    );
  }

  return {
    report,
    checking,
    updating,
    error,
    notice,
    refresh: () => load(true),
    updateFor,
    isAutoUpdate,
    applyUpdate,
    setAutoUpdate,
  };
}

export type ExtensionUpdatesState = ReturnType<typeof useExtensionUpdates>;

/** "Check for updates" plus the result/error banners. */
export function ExtensionUpdatesBar({ state }: { state: ExtensionUpdatesState }) {
  const { t } = useT();
  const count = state.report?.updates.length ?? 0;
  return (
    <div className="jf-stack jf-stack--sm">
      <div className="jf-row">
        <span className="jf-meta">
          {state.checking
            ? t("extensionUpdates.checking")
            : count > 0
              ? t("extensionUpdates.availableCount", { count })
              : state.report
                ? t("extensionUpdates.upToDate")
                : ""}
        </span>
        <button
          type="button"
          className="jf-btn jf-btn--ghost"
          style={{ marginInlineStart: "auto" }}
          onClick={() => void state.refresh()}
          disabled={state.checking}
        >
          {t("extensionUpdates.checkNow")}
        </button>
      </div>
      {state.report?.autoUpdateDisabledByOperator && (
        <p className="jf-field__hint">{t("extensionUpdates.operatorDisabled")}</p>
      )}
      {state.error && <div className="jf-alert jf-alert--error" role="alert">{state.error}</div>}
      {state.notice && <div className="jf-alert jf-alert--success" role="status">{state.notice}</div>}
    </div>
  );
}

/** "Update to vX" button for one extension; renders nothing when it is current. */
export function ExtensionUpdateButton({
  state,
  type,
  id,
  block = false,
  onUpdated,
}: {
  state: ExtensionUpdatesState;
  type: ExtensionType;
  id: string;
  block?: boolean;
  onUpdated?: (result: UpdatedExtension) => void;
}) {
  const { t } = useT();
  const update = state.updateFor(type, id);
  if (!update) return null;
  const busy = state.updating === `${type}:${id}`;
  return (
    <button
      type="button"
      className={`jf-btn jf-btn--primary${block ? " jf-btn--block" : ""}`}
      disabled={busy || state.updating !== null}
      title={t("extensionUpdates.updateTitle", {
        from: update.installedVersion,
        to: update.availableVersion,
      })}
      onClick={() => {
        if (!update.autoUpdatable && !window.confirm(t("extensionUpdates.majorConfirm", {
          name: update.name,
          from: update.installedVersion,
          to: update.availableVersion,
        }))) {
          return;
        }
        void state.applyUpdate(update).then((result) => {
          if (result) onUpdated?.(result);
        });
      }}
    >
      {busy ? t("extensionUpdates.updating") : t("extensionUpdates.updateTo", { version: update.availableVersion })}
    </button>
  );
}

/** Badge shown next to the installed version while an update is waiting. */
export function ExtensionUpdateBadge({
  state,
  type,
  id,
}: {
  state: ExtensionUpdatesState;
  type: ExtensionType;
  id: string;
}) {
  const { t } = useT();
  const update = state.updateFor(type, id);
  if (!update) return null;
  return (
    <span className="jf-badge jf-badge--warn">
      {t("extensionUpdates.badge", { version: update.availableVersion })}
    </span>
  );
}

/** Per-extension auto-update switch. */
export function ExtensionAutoUpdateToggle({
  state,
  type,
  id,
}: {
  state: ExtensionUpdatesState;
  type: ExtensionType;
  id: string;
}) {
  const { t } = useT();
  if (!state.report) return null;
  const on = state.isAutoUpdate(type, id);
  return (
    <label className="jf-meta" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => void state.setAutoUpdate(type, id, e.target.checked)}
      />
      {t("extensionUpdates.autoUpdate")}
    </label>
  );
}
