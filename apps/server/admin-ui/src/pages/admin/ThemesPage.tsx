import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSessionRole } from "@components/SessionProvider";

interface Theme {
  id: string;
  theme_id?: string;
  themeId?: string;
  name: string;
  version: string;
  description?: string | null;
  publisher: string;
  status: string;
  active?: boolean;
  manifest?: { installedPath?: string };
}

interface RegistryTheme {
  id: string;
  name: string;
  version: string;
  description?: string;
  publisher?: string;
  type: "theme";
  registry?: {
    listed?: boolean;
    free?: boolean;
    comingSoon?: boolean;
    price?: { amount?: number; currency?: string };
  };
  pricing?: { type?: "free" | "paid"; amount?: number; currency?: string };
}

export default function ThemesPage() {
  // Uploading and activating a theme are administrator-only on the server;
  // an editor (who can also reach this page) can only view and customize.
  const canManage = useSessionRole() === "administrator";
  const [themes, setThemes] = useState<Theme[]>([]);
  const [availableThemes, setAvailableThemes] = useState<RegistryTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(canManage);
  const [catalogError, setCatalogError] = useState("");
  const [installingTheme, setInstallingTheme] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/themes")
      .then((r) => r.json())
      .then((data: { themes?: Theme[] }) => {
        if (Array.isArray(data.themes)) {
          setThemes(data.themes.map((t) => ({ ...t, active: t.status === "active" })));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!canManage) return;
    fetch("/api/marketplace?type=themes")
      .then(async (res) => {
        const data = await res.json() as { items?: RegistryTheme[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Theme catalog unavailable");
        return data;
      })
      .then((data) => {
        setAvailableThemes(
          Array.isArray(data.items)
            ? data.items.filter((item) => item.type === "theme" && item.registry?.listed !== false)
            : [],
        );
      })
      .catch((err: unknown) => setCatalogError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCatalogLoading(false));
  }, [canManage]);

  async function handleFile(file: File) {
    setUploading(true);
    setUploadError("");
    setUploadSuccess("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/themes", { method: "POST", body: form });
      const data = await res.json() as { theme?: Theme; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      if (data.theme) {
        setThemes((t) => [...t, { ...data.theme!, status: "installed", active: false }]);
        setUploadSuccess(`"${data.theme.name}" installed successfully`);
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function activateTheme(themeId: string) {
    const res = await fetch(`/api/themes/${encodeURIComponent(themeId)}/activate`, { method: "POST" });
    if (res.ok) {
      setThemes((list) => list.map((t) => ({
        ...t,
        active: t.theme_id === themeId,
        status: t.theme_id === themeId ? "active" : "inactive",
      })));
    }
  }

  async function installTheme(theme: RegistryTheme) {
    setInstallingTheme(theme.id);
    setCatalogError("");
    try {
      const res = await fetch("/api/marketplace/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "theme", id: theme.id, version: theme.version }),
      });
      const data = await res.json() as {
        theme?: Theme;
        error?: string;
        checkoutUrl?: string;
      };
      if (res.status === 402) {
        window.open(data.checkoutUrl ?? "https://justflows.com/marketplace", "_blank");
      }
      if (!res.ok) throw new Error(data.error ?? "Theme installation failed");
      if (data.theme) {
        setThemes((current) => [
          ...current.filter((installed) => (installed.theme_id ?? installed.themeId ?? installed.id) !== theme.id),
          { ...data.theme!, theme_id: data.theme!.theme_id ?? data.theme!.themeId, status: "installed", active: false },
        ]);
        setUploadSuccess(`"${data.theme.name}" installed successfully`);
      }
    } catch (err: unknown) {
      setCatalogError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallingTheme(null);
    }
  }

  async function removeTheme(theme: Theme) {
    const themeId = theme.theme_id ?? theme.themeId ?? theme.id;
    if (!confirm(`Delete "${theme.name}"? You can install it again from the marketplace.`)) return;
    setDeleteError("");
    const res = await fetch(`/api/themes/${encodeURIComponent(themeId)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({})) as { error?: string };
    if (!res.ok) {
      setDeleteError(data.error ?? "Theme could not be deleted");
      return;
    }
    setThemes((current) => current.filter(
      (installed) => (installed.theme_id ?? installed.themeId ?? installed.id) !== themeId,
    ));
  }

  const activeTheme = themes.find((t) => t.active || t.status === "active");

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>Themes</h1>
          <p>Manage the appearance of your site</p>
        </div>
        <div className="jf-pagehead__actions">
          <Link to="/admin/menus" className="jf-btn jf-btn--ghost">Configure menus</Link>
          {activeTheme && (
            <Link to="/admin/themes/customize" className="jf-btn jf-btn--primary">
              Customize active theme
            </Link>
          )}
        </div>
      </header>

      {canManage && (
      <div className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">Upload theme</h2>
        </div>
        <div className="jf-card__body jf-stack">
          <input
            ref={fileInputRef}
            type="file"
            accept=".jfpkg,.zip"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <div className="jf-row">
            <button
              className="jf-btn jf-btn--primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Installing…" : "Choose .jfpkg file…"}
            </button>
            <span className="jf-meta">Upload a .jfpkg theme package to install it</span>
          </div>
          {uploadError && <div className="jf-alert jf-alert--error" role="alert">{uploadError}</div>}
          {uploadSuccess && <div className="jf-alert jf-alert--success">{uploadSuccess}</div>}
        </div>
      </div>
      )}

      {deleteError && <div className="jf-alert jf-alert--error" role="alert">{deleteError}</div>}

      {loading ? (
        <div className="jf-cardgrid">
          <div className="jf-skeleton" style={{ height: 300 }} />
          <div className="jf-skeleton" style={{ height: 300 }} />
          <div className="jf-skeleton" style={{ height: 300 }} />
        </div>
      ) : themes.length === 0 ? (
        <div className="jf-card">
          <div className="jf-empty">
            <span className="jf-empty__icon" aria-hidden="true">🎨</span>
            <span className="jf-empty__title">No themes installed</span>
            <p>Upload a .jfpkg file above to install your first theme.</p>
          </div>
        </div>
      ) : (
        <div className="jf-cardgrid">
          {themes.map((theme) => {
            const isActive = theme.active || theme.status === "active";
            const themeId = theme.theme_id ?? theme.id;
            return (
              <div key={themeId} className={`jf-card${isActive ? " jf-card--active" : ""}`}>
                <div className="jf-thumb" aria-hidden="true">🎨</div>
                <div className="jf-card__body jf-stack jf-stack--sm">
                  <div className="jf-row">
                    <strong>{theme.name}</strong>
                    {isActive && (
                      <span className="jf-badge jf-badge--info" style={{ marginInlineStart: "auto" }}>
                        active
                      </span>
                    )}
                  </div>
                  {theme.description && <p className="jf-list__desc">{theme.description}</p>}
                  <p className="jf-meta">v{theme.version} by {theme.publisher}</p>
                  {isActive ? (
                    <Link to="/admin/themes/customize" className="jf-btn jf-btn--primary jf-btn--block">
                      Customize
                    </Link>
                  ) : canManage ? (
                    <div className="jf-stack jf-stack--sm">
                      <button
                        className="jf-btn jf-btn--ghost jf-btn--block"
                        onClick={() => activateTheme(themeId)}
                      >
                        Activate
                      </button>
                      {themeId !== "justflows.default" && (
                        <button
                          className="jf-btn jf-btn--danger jf-btn--block"
                          onClick={() => void removeTheme(theme)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canManage && (
        <section className="jf-stack">
          <div>
            <h2>Available themes</h2>
            <p className="jf-meta">Themes published in the Justflows marketplace.</p>
          </div>
          {catalogError && <div className="jf-alert jf-alert--error" role="alert">{catalogError}</div>}
          {catalogLoading ? (
            <div className="jf-cardgrid">
              <div className="jf-skeleton" style={{ height: 260 }} />
              <div className="jf-skeleton" style={{ height: 260 }} />
            </div>
          ) : availableThemes.length === 0 ? (
            <div className="jf-card">
              <div className="jf-empty">
                <span className="jf-empty__icon" aria-hidden="true">🛍️</span>
                <span className="jf-empty__title">No marketplace themes available</span>
              </div>
            </div>
          ) : (
            <div className="jf-cardgrid">
              {availableThemes.map((theme) => {
                const isInstalled = themes.some(
                  (installed) => (installed.theme_id ?? installed.themeId ?? installed.id) === theme.id,
                );
                const isComingSoon = theme.registry?.comingSoon === true;
                const isPaid = typeof theme.registry?.free === "boolean"
                  ? !theme.registry.free
                  : theme.pricing?.type === "paid";
                return (
                  <div key={theme.id} className="jf-card">
                    <div className="jf-thumb" aria-hidden="true">🎨</div>
                    <div className="jf-card__body jf-stack jf-stack--sm">
                      <div className="jf-row">
                        <strong>{theme.name}</strong>
                        {isPaid && <span className="jf-badge" style={{ marginInlineStart: "auto" }}>paid</span>}
                      </div>
                      {theme.description && <p className="jf-list__desc">{theme.description}</p>}
                      <p className="jf-meta">v{theme.version} by {theme.publisher ?? "Unknown publisher"}</p>
                      <button
                        className="jf-btn jf-btn--primary jf-btn--block"
                        disabled={isInstalled || isComingSoon || installingTheme === theme.id}
                        onClick={() => void installTheme(theme)}
                      >
                        {isInstalled
                          ? "Installed"
                          : isComingSoon
                            ? "Coming soon"
                            : installingTheme === theme.id
                              ? "Installing…"
                              : isPaid
                                ? "View purchase options"
                                : "Install"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
