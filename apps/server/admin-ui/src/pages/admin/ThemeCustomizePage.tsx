import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageBuilder, { type BlockDocument } from "@components/builder/PageBuilder";
import BlockJsonTools from "@components/builder/BlockJsonTools";
import MediaImageField from "@components/MediaImageField";

type ControlType = "color" | "font" | "text" | "image" | "range" | "code" | "select";

interface Control {
  label: string;
  type: ControlType;
  default: string | number;
  min?: number;
  max?: number;
  unit?: string;
  options?: { label: string; value: string }[];
  description?: string;
}

interface Section {
  label: string;
  controls: Record<string, Control>;
}

interface ThemeMods {
  identity?: Record<string, string>;
  colors?: Record<string, string>;
  typography?: Record<string, string | number>;
  layout?: Record<string, string | number>;
  navigation?: Record<string, string>;
  advanced?: Record<string, string>;
}

const SECTION_ORDER = ["identity", "colors", "typography", "layout", "navigation", "advanced"] as const;
type EditorTab = "homepage" | "styles";

export default function CustomizeThemePage() {
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stylesSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [themeName, setThemeName] = useState("");
  const [schema, setSchema] = useState<Record<string, Section>>({});
  const [mods, setMods] = useState<ThemeMods>({});
  const [blocks, setBlocks] = useState<BlockDocument>({ version: 1, blocks: [] });
  const [openSection, setOpenSection] = useState<string>("identity");
  const [tab, setTab] = useState<EditorTab>("homepage");

  const reloadPreview = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.src = `/?preview=1&_=${Date.now()}`;
  }, []);

  useEffect(() => {
    fetch("/api/themes/customize")
      .then(async (r) => {
        const data = await r.json() as {
          error?: string;
          theme?: { name: string };
          schema?: Record<string, Section>;
          mods?: ThemeMods;
          blocks?: BlockDocument;
        };
        if (!r.ok) throw new Error(data.error ?? "Failed to load customizer");
        setThemeName(data.theme?.name ?? "Theme");
        setSchema(data.schema ?? {});
        setMods(data.mods ?? {});
        setBlocks(data.blocks ?? { version: 1, blocks: [] });
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const persist = useCallback(async (publish = false) => {
    setSaving(!publish);
    setPublishing(publish);
    setError("");
    try {
      const res = await fetch("/api/themes/customize", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mods, blocks, draft: !publish, publish }),
      });
      const data = await res.json() as { error?: string; mods?: ThemeMods; blocks?: BlockDocument };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      if (data.mods) setMods(data.mods);
      if (data.blocks) setBlocks(data.blocks);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      reloadPreview();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
      setPublishing(false);
    }
  }, [mods, blocks, reloadPreview]);

  const queueStylesSave = useCallback((nextMods: ThemeMods) => {
    if (stylesSaveTimer.current) clearTimeout(stylesSaveTimer.current);
    stylesSaveTimer.current = setTimeout(async () => {
      setSaving(true);
      setError("");
      try {
        const res = await fetch("/api/themes/customize", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mods: nextMods, blocks, draft: true, publish: false }),
        });
        const data = await res.json() as { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Failed to save draft");
        reloadPreview();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    }, 400);
  }, [blocks, reloadPreview]);

  function updateMod(section: keyof ThemeMods, key: string, value: string | number) {
    setMods((prev) => {
      const next = {
        ...prev,
        [section]: { ...(prev[section] ?? {}), [key]: value },
      };
      queueStylesSave(next);
      return next;
    });
  }

  function handleBlocksChange(doc: BlockDocument) {
    setBlocks(doc);
    setDirty(true);
  }

  function handleJsonImport(doc: BlockDocument, importedMods?: Record<string, unknown>) {
    setBlocks(doc);
    setDirty(true);
    if (importedMods) {
      setMods((prev) => ({ ...prev, ...importedMods as ThemeMods }));
    }
  }

  async function exitCustomize() {
    if (dirty && !window.confirm("You have unsaved homepage changes. Exit anyway?")) return;
    await fetch("/api/themes/customize", { method: "DELETE" }).catch(() => {});
    navigate("/admin/themes");
  }

  if (loading) return <div className="jf-center">Loading theme builder…</div>;

  if (error && !themeName) {
    return (
      <div className="jf-center">
        <div className="jf-stack" style={{ alignItems: "center" }}>
          <div className="jf-alert jf-alert--error">{error}</div>
          <button className="jf-btn jf-btn--ghost" onClick={() => navigate("/admin/themes")}>
            Back to themes
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="jf-editor">
      <header className="jf-editor__bar">
        <button type="button" className="jf-btn jf-btn--onbar" onClick={exitCustomize}>
          ← Exit
        </button>

        <div className="jf-editor__title">
          <div className="jf-editor__name">Theme builder · {themeName}</div>
          <div className="jf-editor__sub">
            {tab === "homepage" ? "Edit homepage blocks" : "Colors, fonts & layout"}
            {dirty ? " · unsaved changes" : ""}
          </div>
        </div>

        <div className="jf-editor__actions">
          {saved && <span className="jf-editor__status jf-editor__status--ok">✓ Saved</span>}
          {saving && !publishing && <span className="jf-editor__status">Saving…</span>}
          {error && <span className="jf-editor__status jf-editor__status--error">{error}</span>}
          <a className="jf-btn jf-btn--onbar" href="/?preview=1" target="_blank" rel="noreferrer">
            Preview ↗
          </a>
          {tab === "homepage" && (
            <BlockJsonTools
              blocks={blocks}
              mods={mods}
              onImport={handleJsonImport}
              exportFilename={`${themeName.toLowerCase().replace(/\s+/g, "-")}-design.json`}
              variant="bar"
            />
          )}
          <button
            type="button"
            className="jf-btn jf-btn--onbar"
            disabled={saving || publishing}
            onClick={() => persist(false)}
          >
            {saving ? "Saving…" : "Save draft"}
          </button>
          <button
            type="button"
            className="jf-btn jf-btn--primary"
            disabled={saving || publishing}
            onClick={() => persist(true)}
          >
            {publishing ? "Publishing…" : "Publish"}
          </button>
        </div>
      </header>

      <div className="jf-theme-builder__tabs">
        <button
          type="button"
          className={`jf-theme-builder__tab${tab === "homepage" ? " jf-theme-builder__tab--active" : ""}`}
          onClick={() => setTab("homepage")}
        >
          Homepage
        </button>
        <button
          type="button"
          className={`jf-theme-builder__tab${tab === "styles" ? " jf-theme-builder__tab--active" : ""}`}
          onClick={() => setTab("styles")}
        >
          Styles
        </button>
      </div>

      {tab === "homepage" ? (
        <div className="jf-editor__body">
          <PageBuilder value={blocks} onChange={handleBlocksChange} />
        </div>
      ) : (
        <div className="jf-customizer">
          <aside className="jf-customizer__controls">
            {SECTION_ORDER.filter((key) => schema[key]).map((sectionKey) => {
              const section = schema[sectionKey]!;
              const isOpen = openSection === sectionKey;
              return (
                <div key={sectionKey} className="jf-accordion">
                  <button
                    className="jf-accordion__trigger"
                    aria-expanded={isOpen}
                    onClick={() => setOpenSection(isOpen ? "" : sectionKey)}
                  >
                    <span className="jf-accordion__caret" aria-hidden="true">▸</span>
                    {section.label}
                  </button>
                  {isOpen && (
                    <div className="jf-accordion__panel">
                      {sectionKey === "navigation" && (
                        <p className="jf-field__hint">
                          Assign menus to theme locations.{" "}
                          <a href="/admin/menus" target="_blank" rel="noopener noreferrer">Edit menus →</a>
                        </p>
                      )}
                      {Object.entries(section.controls).map(([key, control]) => (
                        <ControlField
                          key={key}
                          controlKey={key}
                          sectionKey={sectionKey}
                          control={control}
                          value={(mods[sectionKey as keyof ThemeMods] as Record<string, string | number> | undefined)?.[key] ?? control.default}
                          onChange={(v) => updateMod(sectionKey as keyof ThemeMods, key, v)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </aside>

          <div className="jf-customizer__preview">
            <div className="jf-card__title">Live preview</div>
            <iframe ref={iframeRef} src="/?preview=1" title="Theme preview" />
          </div>
        </div>
      )}
    </div>
  );
}

function ControlField({
  controlKey,
  sectionKey,
  control,
  value,
  onChange,
}: {
  controlKey: string;
  sectionKey: string;
  control: Control;
  value: string | number;
  onChange: (v: string | number) => void;
}) {
  const id = `${sectionKey}-${controlKey}`;

  if (control.type === "color") {
    return (
      <div className="jf-field">
        <label className="jf-field__label" htmlFor={id}>{control.label}</label>
        <div className="jf-row" style={{ flexWrap: "nowrap" }}>
          <input
            id={id}
            className="jf-swatch"
            type="color"
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
          />
          <input
            className="jf-input jf-input--mono"
            type="text"
            value={String(value)}
            aria-label={`${control.label} hex value`}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      </div>
    );
  }

  if ((control.type === "font" || control.type === "select") && control.options) {
    return (
      <div className="jf-field">
        <label className="jf-field__label" htmlFor={id}>{control.label}</label>
        <select id={id} className="jf-input" value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {control.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    );
  }

  if (control.type === "range") {
    return (
      <div className="jf-field">
        <label className="jf-field__label" htmlFor={id}>
          {control.label}: {value}{control.unit ?? ""}
        </label>
        <input
          id={id}
          type="range"
          min={control.min}
          max={control.max}
          value={Number(value)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    );
  }

  if (control.type === "code") {
    return (
      <div className="jf-field">
        <label className="jf-field__label" htmlFor={id}>{control.label}</label>
        <textarea
          id={id}
          className="jf-input jf-input--mono"
          rows={6}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder="/* Your custom CSS */"
        />
      </div>
    );
  }

  if (control.type === "image") {
    return (
      <MediaImageField
        id={id}
        label={control.label}
        description={control.description}
        value={String(value)}
        onChange={(url) => onChange(url)}
      />
    );
  }

  return (
    <div className="jf-field">
      <label className="jf-field__label" htmlFor={id}>{control.label}</label>
      {control.description ? <p className="jf-field__hint">{control.description}</p> : null}
      <input
        id={id}
        className="jf-input"
        type="text"
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
