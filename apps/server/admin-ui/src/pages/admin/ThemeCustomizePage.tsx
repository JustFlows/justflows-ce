import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import MediaImageField from "@components/MediaImageField";
import PageBuilder, { type BlockDocument } from "@components/builder/PageBuilder";
import HeaderLibraryEditor from "./HeaderLibraryEditor";

type ControlType = "color" | "font" | "text" | "image" | "range" | "code" | "select";

interface Control {
  label: string;
  type: ControlType;
  default: string | number;
  min?: number;
  max?: number;
  step?: number;
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
  colorsDark?: Record<string, string>;
  typography?: Record<string, string | number>;
  headings?: Record<string, string | number>;
  spacing?: Record<string, string | number>;
  radius?: Record<string, string | number>;
  shadow?: Record<string, string>;
  layout?: Record<string, string | number>;
  navigation?: Record<string, string>;
  advanced?: Record<string, string>;
  /** Extra sections a theme contributes through its manifest `customize` block. */
  [section: string]: Record<string, string | number> | undefined;
}

interface ThemePageOption {
  id: string;
  title: string;
  slug: string;
  locale: string;
  status: string;
}

const SECTION_ORDER = [
  "identity",
  "colors",
  "colorsDark",
  "typography",
  "headings",
  "spacing",
  "radius",
  "shadow",
  "layout",
  "navigation",
  "advanced",
] as const;
type EditorTab = "homepage" | "blog" | "styles" | "header" | "footer";

function localePath(locale: string, slug: string, defaultLocale: string): string {
  const path = `/${slug}`;
  if (locale === defaultLocale) return path;
  return `/${locale}${path}`;
}

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
  const [pages, setPages] = useState<ThemePageOption[]>([]);
  const [homePageId, setHomePageId] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [blogPageId, setBlogPageId] = useState<string | null>(null);
  const [convertingBlog, setConvertingBlog] = useState(false);
  const [defaultLocale, setDefaultLocale] = useState("en-US");
  const [openSection, setOpenSection] = useState<string>("identity");
  const [footer, setFooter] = useState<BlockDocument>({ version: 1, blocks: [] });
  const [footerSaving, setFooterSaving] = useState(false);
  const [tab, setTab] = useState<EditorTab>("homepage");

  const reloadPreview = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.src = `/?preview=1&_=${Date.now()}`;
  }, []);

  useEffect(() => {
    fetch("/api/template-parts/footer")
      .then((r) => r.json())
      .then((data: { blocks?: unknown[]; draft?: unknown[] }) => {
        const blocks = (data.draft?.length ? data.draft : data.blocks) ?? [];
        setFooter({ version: 1, blocks: blocks as BlockDocument["blocks"] });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/languages/active")
      .then((r) => r.json())
      .then((data: { languages?: { code: string; isDefault?: boolean }[] }) => {
        const langs = data.languages ?? [];
        setDefaultLocale(langs.find((l) => l.isDefault)?.code ?? langs[0]?.code ?? "en-US");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/themes/customize")
      .then(async (r) => {
        const data = (await r.json()) as {
          error?: string;
          theme?: { name: string };
          schema?: Record<string, Section>;
          mods?: ThemeMods;
          homePageId?: string | null;
          blogPageId?: string | null;
          pages?: ThemePageOption[];
        };
        if (!r.ok) throw new Error(data.error ?? "Failed to load customizer");
        setThemeName(data.theme?.name ?? "Theme");
        setSchema(data.schema ?? {});
        setMods(data.mods ?? {});
        setHomePageId(data.homePageId ?? null);
        setBlogPageId(data.blogPageId ?? null);
        setPages(data.pages ?? []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const persist = useCallback(
    async (publish = false) => {
      setSaving(!publish);
      setPublishing(publish);
      setError("");
      try {
        const res = await fetch("/api/themes/customize", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mods, draft: !publish, publish }),
        });
        const data = (await res.json()) as { error?: string; mods?: ThemeMods };
        if (!res.ok) throw new Error(data.error ?? "Failed to save");
        if (data.mods) setMods(data.mods);
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
    },
    [mods, reloadPreview],
  );

  const queueStylesSave = useCallback(
    (nextMods: ThemeMods) => {
      if (stylesSaveTimer.current) clearTimeout(stylesSaveTimer.current);
      stylesSaveTimer.current = setTimeout(async () => {
        setSaving(true);
        setError("");
        try {
          const res = await fetch("/api/themes/customize", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mods: nextMods, draft: true, publish: false }),
          });
          const data = (await res.json()) as { error?: string };
          if (!res.ok) throw new Error(data.error ?? "Failed to save draft");
          reloadPreview();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setSaving(false);
        }
      }, 400);
    },
    [reloadPreview],
  );

  async function selectHomePage(contentId: string | null) {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/settings/home-page", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentId }),
      });
      const data = (await res.json()) as { error?: string; homePageId?: string | null };
      if (!res.ok) throw new Error(data.error ?? "Could not set the home page");
      setHomePageId(data.homePageId ?? null);
      reloadPreview();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function convertThemeHome() {
    if (
      !window.confirm("Create a page from the current homepage layout and use it as the home page?")
    )
      return;
    setConverting(true);
    setError("");
    try {
      const res = await fetch("/api/themes/customize/promote-home", { method: "POST" });
      const data = (await res.json()) as {
        error?: string;
        homePageId?: string;
        page?: ThemePageOption;
      };
      if (!res.ok) throw new Error(data.error ?? "Could not create a home page");
      if (data.page)
        setPages((prev) => [data.page!, ...prev.filter((p) => p.id !== data.page!.id)]);
      setHomePageId(data.homePageId ?? null);
      reloadPreview();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConverting(false);
    }
  }

  async function selectBlogPage(contentId: string | null) {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/settings/blog-page", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentId }),
      });
      const data = (await res.json()) as { error?: string; blogPageId?: string | null };
      if (!res.ok) throw new Error(data.error ?? "Could not set the blog page");
      setBlogPageId(data.blogPageId ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function convertThemeBlog() {
    if (!window.confirm("Create a page from the default blog layout and use it as the blog page?"))
      return;
    setConvertingBlog(true);
    setError("");
    try {
      const res = await fetch("/api/themes/customize/promote-blog", { method: "POST" });
      const data = (await res.json()) as {
        error?: string;
        blogPageId?: string;
        page?: ThemePageOption;
      };
      if (!res.ok) throw new Error(data.error ?? "Could not create a blog page");
      if (data.page)
        setPages((prev) => [data.page!, ...prev.filter((p) => p.id !== data.page!.id)]);
      setBlogPageId(data.blogPageId ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConvertingBlog(false);
    }
  }

  function updateMod(section: string, key: string, value: string | number) {
    setMods((prev) => {
      const next = {
        ...prev,
        [section]: { ...(prev[section] ?? {}), [key]: value },
      };
      queueStylesSave(next);
      return next;
    });
  }

  async function saveFooter(publish: boolean) {
    setFooterSaving(true);
    setError("");
    try {
      const res = await fetch("/api/template-parts/footer", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks: footer.blocks, draft: !publish }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not save the footer");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      reloadPreview();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFooterSaving(false);
    }
  }

  async function exitCustomize() {
    if (dirty && !window.confirm("You have unsaved style changes. Exit anyway?")) return;
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

  const selectedHome = pages.find((page) => page.id === homePageId) ?? null;
  const selectedBlog = pages.find((page) => page.id === blogPageId) ?? null;
  const blogPreviewSrc = selectedBlog
    ? `${localePath(selectedBlog.locale, selectedBlog.slug, defaultLocale)}?preview=1`
    : null;

  return (
    <div className="jf-editor">
      <header className="jf-editor__bar">
        <button type="button" className="jf-btn jf-btn--onbar" onClick={exitCustomize}>
          ← Exit
        </button>

        <div className="jf-editor__title">
          <div className="jf-editor__name">Theme builder · {themeName}</div>
          <div className="jf-editor__sub">
            {tab === "homepage"
              ? "Choose which page is the site home"
              : tab === "blog"
                ? "Choose which page lists your blog posts"
                : tab === "header"
                  ? "Named headers, one shown on every page — with per-language overrides"
                  : tab === "footer"
                    ? "Blocks shown at the bottom of every page"
                    : "Colors, fonts, spacing, headings & layout"}
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
          {tab === "styles" && (
            <>
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
            </>
          )}
          {tab === "footer" && (
            <>
              <button
                type="button"
                className="jf-btn jf-btn--onbar"
                disabled={footerSaving}
                onClick={() => void saveFooter(false)}
              >
                {footerSaving ? "Saving…" : "Save draft"}
              </button>
              <button
                type="button"
                className="jf-btn jf-btn--primary"
                disabled={footerSaving}
                onClick={() => void saveFooter(true)}
              >
                Publish
              </button>
            </>
          )}
        </div>
      </header>

      <div className="jf-theme-builder__tabs">
        <button
          type="button"
          className={`jf-theme-builder__tab${tab === "homepage" ? " jf-theme-builder__tab--active" : ""}`}
          onClick={() => setTab("homepage")}
        >
          Home page
        </button>
        <button
          type="button"
          className={`jf-theme-builder__tab${tab === "blog" ? " jf-theme-builder__tab--active" : ""}`}
          onClick={() => setTab("blog")}
        >
          Blog
        </button>
        <button
          type="button"
          className={`jf-theme-builder__tab${tab === "styles" ? " jf-theme-builder__tab--active" : ""}`}
          onClick={() => setTab("styles")}
        >
          Styles
        </button>
        <button
          type="button"
          className={`jf-theme-builder__tab${tab === "header" ? " jf-theme-builder__tab--active" : ""}`}
          onClick={() => setTab("header")}
        >
          Header
        </button>
        <button
          type="button"
          className={`jf-theme-builder__tab${tab === "footer" ? " jf-theme-builder__tab--active" : ""}`}
          onClick={() => setTab("footer")}
        >
          Footer
        </button>
      </div>

      {tab === "homepage" ? (
        <div className="jf-customizer">
          <aside className="jf-customizer__controls" style={{ padding: "1rem" }}>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-home-page">
                Home page
              </label>
              <select
                id="jf-home-page"
                className="jf-input"
                value={homePageId ?? ""}
                disabled={saving || converting}
                onChange={(e) => selectHomePage(e.target.value || null)}
              >
                <option value="">Theme layout (not a page yet)</option>
                {pages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.title || page.slug}{" "}
                    {page.status !== "published" ? `(${page.status})` : ""}
                  </option>
                ))}
              </select>
              <p className="jf-field__hint">
                Any page can be the home page. Edit its header, menu, and blocks in the page
                builder.
              </p>
            </div>
            {selectedHome ? (
              <div className="jf-stack" style={{ gap: "0.6rem" }}>
                <Link
                  className="jf-btn jf-btn--primary jf-btn--block"
                  to={`/admin/content/${selectedHome.id}/builder`}
                >
                  Edit this page
                </Link>
                <Link
                  className="jf-btn jf-btn--ghost jf-btn--block"
                  to={`/admin/content/${selectedHome.id}`}
                >
                  Page settings
                </Link>
                <p className="jf-field__hint" style={{ margin: 0 }}>
                  Live at / · permalink /{selectedHome.slug}
                </p>
              </div>
            ) : (
              <div className="jf-stack" style={{ gap: "0.6rem" }}>
                <button
                  type="button"
                  className="jf-btn jf-btn--primary jf-btn--block"
                  disabled={converting}
                  onClick={() => void convertThemeHome()}
                >
                  {converting ? "Creating…" : "Turn current layout into a page"}
                </button>
                <Link
                  className="jf-btn jf-btn--ghost jf-btn--block"
                  to="/admin/content/new?type=page"
                >
                  Create a new page
                </Link>
                <p className="jf-field__hint" style={{ margin: 0 }}>
                  Until you pick a page, / still uses the theme homepage layout.
                </p>
              </div>
            )}
          </aside>
          <div className="jf-customizer__preview">
            <div className="jf-card__title">Live preview</div>
            <iframe ref={iframeRef} src="/?preview=1" title="Home page preview" />
          </div>
        </div>
      ) : tab === "blog" ? (
        <div className="jf-customizer">
          <aside className="jf-customizer__controls" style={{ padding: "1rem" }}>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-blog-page">
                Blog page
              </label>
              <select
                id="jf-blog-page"
                className="jf-input"
                value={blogPageId ?? ""}
                disabled={saving || convertingBlog}
                onChange={(e) => selectBlogPage(e.target.value || null)}
              >
                <option value="">No blog page yet</option>
                {pages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.title || page.slug}{" "}
                    {page.status !== "published" ? `(${page.status})` : ""}
                  </option>
                ))}
              </select>
              <p className="jf-field__hint">
                Any page can be the blog page — drop a "Post List" block on it in the page builder
                to list posts, or use the default layout below as a starting point.
              </p>
            </div>
            {selectedBlog ? (
              <div className="jf-stack" style={{ gap: "0.6rem" }}>
                <Link
                  className="jf-btn jf-btn--primary jf-btn--block"
                  to={`/admin/content/${selectedBlog.id}/builder`}
                >
                  Edit this page
                </Link>
                <Link
                  className="jf-btn jf-btn--ghost jf-btn--block"
                  to={`/admin/content/${selectedBlog.id}`}
                >
                  Page settings
                </Link>
                <p className="jf-field__hint" style={{ margin: 0 }}>
                  Live at /{selectedBlog.slug}
                </p>
              </div>
            ) : (
              <div className="jf-stack" style={{ gap: "0.6rem" }}>
                <button
                  type="button"
                  className="jf-btn jf-btn--primary jf-btn--block"
                  disabled={convertingBlog}
                  onClick={() => void convertThemeBlog()}
                >
                  {convertingBlog ? "Creating…" : "Turn default blog layout into a page"}
                </button>
                <Link
                  className="jf-btn jf-btn--ghost jf-btn--block"
                  to="/admin/content/new?type=page"
                >
                  Create a new page
                </Link>
                <p className="jf-field__hint" style={{ margin: 0 }}>
                  Until you pick a page, the site has no blog index.
                </p>
              </div>
            )}
          </aside>
          <div className="jf-customizer__preview">
            <div className="jf-card__title">Live preview</div>
            {blogPreviewSrc ? (
              <iframe src={blogPreviewSrc} title="Blog page preview" />
            ) : (
              <p className="jf-field__hint" style={{ padding: "1rem" }}>
                Pick or create a blog page to preview it here.
              </p>
            )}
          </div>
        </div>
      ) : tab === "footer" ? (
        <div className="jf-editor__body">
          <PageBuilder value={footer} onChange={setFooter} />
        </div>
      ) : tab === "header" ? (
        <div className="jf-editor__body">
          <HeaderLibraryEditor />
        </div>
      ) : (
        <div className="jf-customizer">
          <aside className="jf-customizer__controls">
            {[
              ...SECTION_ORDER.filter((key) => schema[key]),
              // Sections a theme package added via its manifest `customize`
              // block — rendered after the built-ins, in manifest order.
              ...Object.keys(schema).filter(
                (key) => !SECTION_ORDER.includes(key as (typeof SECTION_ORDER)[number]),
              ),
            ].map((sectionKey) => {
              const section = schema[sectionKey]!;
              const isOpen = openSection === sectionKey;
              return (
                <div key={sectionKey} className="jf-accordion">
                  <button
                    className="jf-accordion__trigger"
                    aria-expanded={isOpen}
                    onClick={() => setOpenSection(isOpen ? "" : sectionKey)}
                  >
                    <span className="jf-accordion__caret" aria-hidden="true">
                      ▸
                    </span>
                    {section.label}
                  </button>
                  {isOpen && (
                    <div className="jf-accordion__panel">
                      {sectionKey === "colorsDark" && (
                        <p className="jf-field__hint">
                          Used when a visitor picks dark mode, or when their device asks for it and
                          they have not chosen. These are a separate palette — changing a colour
                          above does not change it here.
                        </p>
                      )}
                      {sectionKey === "navigation" && (
                        <p className="jf-field__hint">
                          Assign the default header and footer menus. Build the headers themselves
                          on the Header tab; each page picks one from a dropdown.{" "}
                          <a href="/admin/menus" target="_blank" rel="noopener noreferrer">
                            Edit menus →
                          </a>
                        </p>
                      )}
                      {Object.entries(section.controls).map(([key, control]) => (
                        <ControlField
                          key={key}
                          controlKey={key}
                          sectionKey={sectionKey}
                          control={control}
                          value={mods[sectionKey]?.[key] ?? control.default}
                          onChange={(v) => updateMod(sectionKey, key, v)}
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
        <label className="jf-field__label" htmlFor={id}>
          {control.label}
        </label>
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
        <label className="jf-field__label" htmlFor={id}>
          {control.label}
        </label>
        <select
          id={id}
          className="jf-input"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {control.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (control.type === "range") {
    return (
      <div className="jf-field">
        <label className="jf-field__label" htmlFor={id}>
          {control.label}: {value}
          {control.unit ?? ""}
        </label>
        <input
          id={id}
          type="range"
          min={control.min}
          max={control.max}
          step={control.step ?? 1}
          value={Number(value)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    );
  }

  if (control.type === "code") {
    return (
      <div className="jf-field">
        <label className="jf-field__label" htmlFor={id}>
          {control.label}
        </label>
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
      <label className="jf-field__label" htmlFor={id}>
        {control.label}
      </label>
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
