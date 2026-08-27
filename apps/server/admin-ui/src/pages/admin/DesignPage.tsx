import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/I18nProvider";
import { useSessionRole } from "@components/SessionProvider";

interface CssProvider {
  id: string;
  provider_id: string;
  name: string;
  version: string;
  description?: string;
  publisher: string;
  status: "active" | "inactive" | "installed" | "error";
  active?: boolean;
}

export default function DesignPage() {
  const { t } = useT();
  // Everyone who can reach Design can see what's installed; uploading,
  // activating, and deleting a provider are all administrator-only.
  const canManage = useSessionRole() === "administrator";
  const [providers, setProviders] = useState<CssProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [dragging, setDragging] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [activateError, setActivateError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/css-providers")
      .then((r) => r.json())
      .then((data: { providers?: CssProvider[] }) => {
        if (Array.isArray(data.providers)) setProviders(data.providers);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleFile(file: File) {
    if (!file.name.endsWith(".jfpkg") && !file.name.endsWith(".zip")) {
      setUploadError(t("design.uploadInvalid"));
      return;
    }

    setUploading(true);
    setUploadError("");
    setUploadSuccess("");

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/css-providers", { method: "POST", body: form });
      const data = await res.json() as { provider?: CssProvider; error?: string };
      if (!res.ok) throw new Error(data.error ?? t("design.uploadFailed"));
      if (data.provider) {
        setProviders((list) => [...list, data.provider!]);
        setUploadSuccess(t("design.uploadSuccess", { name: data.provider.name }));
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function activateProvider(providerId: string) {
    setActivatingId(providerId);
    setActivateError("");

    try {
      const res = await fetch(`/api/css-providers/${encodeURIComponent(providerId)}/activate`, {
        method: "POST",
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? t("design.activateFailed"));

      setProviders((list) =>
        list.map((p) => ({
          ...p,
          active: p.provider_id === providerId,
          status: p.provider_id === providerId ? "active" : "inactive",
        })),
      );
    } catch (e) {
      setActivateError(e instanceof Error ? e.message : String(e));
    } finally {
      setActivatingId(null);
    }
  }

  async function deleteProvider(providerId: string) {
    if (!confirm(t("design.deleteConfirm"))) return;
    const res = await fetch(`/api/css-providers/${encodeURIComponent(providerId)}`, {
      method: "DELETE",
    });
    const data = await res.json() as { error?: string };
    if (!res.ok) {
      alert(data.error ?? t("design.deleteFailed"));
      return;
    }
    setProviders((list) => list.filter((p) => p.provider_id !== providerId));
  }

  const activeProvider = providers.find((p) => p.active || p.status === "active");

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("design.title")}</h1>
          <p>{t("design.subtitle")}</p>
        </div>
      </header>

      {activeProvider && (
        <div className="jf-alert jf-alert--info">
          {t("design.activeProvider", { name: activeProvider.name })}
        </div>
      )}

      {activateError && <div className="jf-alert jf-alert--error" role="alert">{activateError}</div>}

      {canManage && (
      <div className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">{t("design.uploadTitle")}</h2>
        </div>
        <div className="jf-card__body jf-stack">
          <div
            className="jf-dropzone jf-dropzone--tall"
            data-dragging={dragging}
            role="button"
            tabIndex={0}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".jfpkg,.zip"
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <span className="jf-dropzone__icon" aria-hidden="true">🎛</span>
            <span className="jf-dropzone__title">
              {uploading ? t("design.uploading") : t("design.dropzoneTitle")}
            </span>
            <span>{t("design.dropzoneHint")}</span>
          </div>

          {uploadError && <div className="jf-alert jf-alert--error" role="alert">{uploadError}</div>}
          {uploadSuccess && <div className="jf-alert jf-alert--success">{uploadSuccess}</div>}
        </div>
      </div>
      )}

      {loading ? (
        <div className="jf-cardgrid">
          <div className="jf-skeleton" style={{ height: 220 }} />
          <div className="jf-skeleton" style={{ height: 220 }} />
          <div className="jf-skeleton" style={{ height: 220 }} />
        </div>
      ) : providers.length === 0 ? (
        <div className="jf-card">
          <div className="jf-empty">
            <span className="jf-empty__icon" aria-hidden="true">🎛</span>
            <span className="jf-empty__title">{t("design.emptyTitle")}</span>
            <p>{t("design.emptyHint")}</p>
          </div>
        </div>
      ) : (
        <div className="jf-cardgrid">
          {providers.map((provider) => {
            const providerId = provider.provider_id ?? provider.id;
            const isActive = provider.active || provider.status === "active";
            const isDefault = providerId === "justflows.none";

            return (
              <div key={providerId} className={`jf-card${isActive ? " jf-card--active" : ""}`}>
                <div className="jf-thumb" aria-hidden="true">🎛</div>
                <div className="jf-card__body jf-stack jf-stack--sm">
                  <div className="jf-row">
                    <strong>{provider.name}</strong>
                    {isActive && (
                      <span className="jf-badge jf-badge--info" style={{ marginInlineStart: "auto" }}>
                        {t("common.active")}
                      </span>
                    )}
                  </div>
                  {provider.description && <p className="jf-list__desc">{provider.description}</p>}
                  <p className="jf-meta">
                    v{provider.version} · {provider.publisher}
                  </p>
                  <p className="jf-meta">
                    <code className="jf-code">{providerId}</code>
                  </p>
                  {canManage && (
                    <div className="jf-row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
                      {!isActive && (
                        <button
                          type="button"
                          className="jf-btn jf-btn--primary"
                          onClick={() => activateProvider(providerId)}
                          disabled={activatingId !== null}
                        >
                          {activatingId === providerId ? t("design.installing") : t("design.activate")}
                        </button>
                      )}
                      {!isDefault && (
                        <button
                          type="button"
                          className="jf-btn jf-btn--danger"
                          onClick={() => deleteProvider(providerId)}
                        >
                          {t("common.delete")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
