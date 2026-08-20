import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

interface Theme {
  id: string;
  theme_id: string;
  name: string;
  version: string;
  description?: string | null;
  publisher: string;
  status: string;
  active?: boolean;
}

export default function ThemesPage() {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");
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
                  ) : (
                    <button
                      className="jf-btn jf-btn--ghost jf-btn--block"
                      onClick={() => activateTheme(themeId)}
                    >
                      Activate
                    </button>
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
