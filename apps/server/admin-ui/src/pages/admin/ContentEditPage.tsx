import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import BlockEditor, { type BlockDocument } from "@components/BlockEditor";
import { useT } from "../../i18n/I18nProvider";

interface ContentItem {
  id: string;
  type: string;
  title: string;
  slug: string;
  locale?: string;
  translationGroupId?: string | null;
  excerpt?: string;
  fields?: Record<string, unknown>;
  status: string;
  blocks?: BlockDocument;
}

interface TranslationSummary {
  id: string;
  locale: string;
  title: string;
  status: string;
}

interface SiteLanguage {
  code: string;
  nativeName: string;
  isDefault?: boolean;
}

function localePath(locale: string, slug: string, defaultLocale: string): string {
  const path = `/${slug}`;
  if (locale === defaultLocale) return path;
  return `/${locale}${path}`;
}

export default function EditContentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useT();

  const [item, setItem] = useState<ContentItem | null>(null);
  const [baseline, setBaseline] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [languages, setLanguages] = useState<SiteLanguage[]>([]);
  const [translations, setTranslations] = useState<TranslationSummary[]>([]);
  const [defaultLocale, setDefaultLocale] = useState("en");

  useEffect(() => {
    fetch("/api/languages/active")
      .then((r) => r.json())
      .then((data: { languages: SiteLanguage[] }) => {
        const langs = data.languages ?? [];
        setLanguages(langs);
        setDefaultLocale(langs.find((l) => l.isDefault)?.code ?? langs[0]?.code ?? "en");
      })
      .catch(() => null);
  }, []);

  const loadTranslations = useCallback(async (groupId: string) => {
    const res = await fetch(`/api/content?translationGroupId=${encodeURIComponent(groupId)}&limit=20`);
    const data = await res.json() as { items?: TranslationSummary[] };
    if (Array.isArray(data.items)) setTranslations(data.items);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/content/${id}`)
      .then(async (r) => {
        const data = await r.json() as ContentItem & { error?: string };
        if (!r.ok) throw new Error(data.error ?? "Failed to load content");
        if (!data.id) throw new Error("Content not found");
        setItem(data);
        setBaseline(JSON.stringify(data));
        const groupId = data.translationGroupId ?? data.id;
        return loadTranslations(groupId);
      })
      .catch((err: Error) => setError(err.message ?? "Failed to load content"))
      .finally(() => setLoading(false));
  }, [id, loadTranslations]);

  const dirty = useMemo(
    () => Boolean(item) && JSON.stringify(item) !== baseline,
    [item, baseline],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!saving && dirty) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  async function save(status?: string) {
    if (!item) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { locale: _locale, translationGroupId: _group, ...payload } = item;
      const res = await fetch(`/api/content/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, ...(status ? { status } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to save"); return; }
      setItem(data);
      setBaseline(JSON.stringify(data));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function createTranslation(locale: string) {
    if (!item) return;
    if (dirty && !confirm(t("content.unsavedLeave"))) return;

    setTranslating(true);
    setError(null);
    try {
      const res = await fetch(`/api/content/${id}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      const data = await res.json() as ContentItem & { error?: string; contentId?: string };
      if (res.status === 409 && data.contentId) {
        navigate(`/admin/content/${data.contentId}`);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Failed to create translation");
        return;
      }
      navigate(`/admin/content/${data.id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setTranslating(false);
    }
  }

  function navigateToTranslation(targetId: string) {
    if (targetId === id) return;
    if (dirty && !confirm(t("content.unsavedLeave"))) return;
    navigate(`/admin/content/${targetId}`);
  }

  async function deleteItem() {
    if (!confirm("Delete this content? This cannot be undone.")) return;
    await fetch(`/api/content/${id}`, { method: "DELETE" });
    navigate("/admin/content");
  }

  function patch(changes: Partial<ContentItem>) {
    setItem((prev) => (prev ? { ...prev, ...changes } : prev));
  }

  function patchField(key: string, value: string) {
    patch({ fields: { ...(item?.fields ?? {}), [key]: value } });
  }

  if (loading) return <EditorSkeleton loadingLabel={t("common.loading")} />;

  if (!item) {
    return (
      <>
        <Topbar onBack={() => navigate("/admin/content")} backLabel={t("common.back")} />
        <div className="jf-page">
          <div className="jf-alert jf-alert--error">{error ?? "Not found"}</div>
        </div>
      </>
    );
  }

  const isPage = item.type === "page";
  const label = isPage ? t("content.editPage") : t("content.editPost");
  const itemLocale = item.locale ?? defaultLocale;
  const publicHref = localePath(itemLocale, item.slug ?? "", defaultLocale);
  const currentLang = languages.find((l) => l.code === itemLocale);

  return (
    <>
      <Topbar onBack={() => navigate("/admin/content")} backLabel={t("common.back")}>
        <div className="jf-topbar__title">
          <span className="jf-topbar__eyebrow">{label}</span>
          <h1>{item.title || t("content.title")}</h1>
        </div>

        <div className="jf-topbar__actions">
          <SaveState saving={saving} saved={saved} dirty={dirty} error={error} t={t} />
          <button className="jf-btn jf-btn--ghost" disabled={saving || !dirty} onClick={() => save()}>
            {saving ? t("common.saving") : t("common.save")}
          </button>
          {item.status === "published" ? (
            <button className="jf-btn jf-btn--ghost" disabled={saving} onClick={() => save("draft")}>
              Unpublish
            </button>
          ) : (
            <button className="jf-btn jf-btn--primary" disabled={saving} onClick={() => save("published")}>
              {t("content.publish")}
            </button>
          )}
        </div>
      </Topbar>

      <div className="jf-page">
        {error && <div className="jf-alert jf-alert--error" role="alert">{error}</div>}

        {languages.length > 1 && (
          <div className="jf-card" style={{ marginBottom: "1.25rem" }}>
            <div className="jf-card__body">
              <div className="jf-field" style={{ marginBottom: "0.75rem" }}>
                <span className="jf-field__label">{t("content.translations")}</span>
              </div>
              <div className="jf-tabs" role="tablist">
                {languages.map((lang) => {
                  const translation = translations.find((tr) => tr.locale === lang.code);
                  const isCurrent = itemLocale === lang.code;

                  if (translation) {
                    return (
                      <button
                        key={lang.code}
                        type="button"
                        role="tab"
                        aria-selected={isCurrent}
                        className="jf-tab"
                        disabled={translating}
                        onClick={() => navigateToTranslation(translation.id)}
                      >
                        {lang.nativeName}
                        {translation.status !== "published" ? " · draft" : ""}
                      </button>
                    );
                  }

                  return (
                    <button
                      key={lang.code}
                      type="button"
                      className="jf-tab jf-tab--add"
                      disabled={translating}
                      onClick={() => createTranslation(lang.code)}
                      title={t("content.addTranslation")}
                    >
                      + {lang.nativeName}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div className="jf-split">
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div className="jf-card">
              <div className="jf-card__body" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div className="jf-field">
                  <label className="jf-sr-only" htmlFor="jf-title">{t("content.title")}</label>
                  <input
                    id="jf-title"
                    className="jf-input jf-input--title"
                    placeholder={t("content.title")}
                    value={item.title}
                    onChange={(e) => patch({ title: e.target.value })}
                  />
                </div>

                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jf-slug">{t("content.slug")}</label>
                  <div className="jf-inputgroup">
                    <span className="jf-inputgroup__prefix">/</span>
                    <input
                      id="jf-slug"
                      className="jf-input"
                      value={item.slug ?? ""}
                      onChange={(e) => patch({ slug: e.target.value })}
                    />
                  </div>
                </div>

                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jf-excerpt">{t("content.excerpt")}</label>
                  <textarea
                    id="jf-excerpt"
                    className="jf-input"
                    value={item.excerpt ?? ""}
                    onChange={(e) => patch({ excerpt: e.target.value })}
                    rows={3}
                  />
                  <span className="jf-field__hint">
                    Shown in listings. Used as the meta description if SEO description is empty.
                  </span>
                </div>
              </div>
            </div>

            <div className="jf-card">
              <div className="jf-card__head">
                <h2 className="jf-card__title">Content</h2>
                {isPage && (
                  <button
                    type="button"
                    className="jf-btn jf-btn--ghost"
                    onClick={() => navigate(`/admin/content/${id}/builder`)}
                  >
                    Open page builder
                  </button>
                )}
              </div>
              <div className="jf-card__body">
                <BlockEditor
                  value={item.blocks ?? { version: 1, blocks: [] }}
                  onChange={(blocks) => patch({ blocks })}
                  compact
                />
              </div>
            </div>
          </div>

          <aside className="jf-rail">
            <div className="jf-card">
              <div className="jf-card__head">
                <h2 className="jf-card__title">Publish</h2>
                <StatusBadge status={item.status} />
              </div>
              <div className="jf-card__body" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div className="jf-field">
                  <span className="jf-field__label">{t("content.locale")}</span>
                  <p className="jf-field__value" style={{ margin: 0 }}>
                    {currentLang ? `${currentLang.nativeName} (${currentLang.code})` : itemLocale}
                  </p>
                  <span className="jf-field__hint">
                    Language is set when content is created. Use the translation tabs above to add other languages.
                  </span>
                </div>

                <button
                  className="jf-btn jf-btn--primary jf-btn--block"
                  disabled={saving || !dirty}
                  onClick={() => save()}
                >
                  {saving ? t("common.saving") : t("common.save")}
                </button>

                {item.status === "published" && (
                  <a
                    className="jf-btn jf-btn--ghost jf-btn--block"
                    href={publicHref}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("content.viewLive")} ↗
                  </a>
                )}
              </div>
            </div>

            <div className="jf-card">
              <div className="jf-card__head">
                <h2 className="jf-card__title">SEO</h2>
              </div>
              <div className="jf-card__body" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jf-seo-title">SEO title</label>
                  <input
                    id="jf-seo-title"
                    className="jf-input"
                    value={typeof item.fields?.seoTitle === "string" ? item.fields.seoTitle : ""}
                    onChange={(e) => patchField("seoTitle", e.target.value)}
                    placeholder={item.title}
                  />
                  <span className="jf-field__hint">Overrides the page title in search results and social shares.</span>
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jf-seo-description">Meta description</label>
                  <textarea
                    id="jf-seo-description"
                    className="jf-input"
                    rows={4}
                    value={typeof item.fields?.seoDescription === "string" ? item.fields.seoDescription : ""}
                    onChange={(e) => patchField("seoDescription", e.target.value)}
                    placeholder={item.excerpt || "A short summary for search engines"}
                  />
                  <span className="jf-field__hint">
                    If empty, the excerpt or title is used. Shown in Google and Open Graph previews.
                  </span>
                </div>
              </div>
            </div>

            <div className="jf-card">
              <div className="jf-card__head">
                <h2 className="jf-card__title">Details</h2>
              </div>
              <div className="jf-card__body">
                <dl style={{ margin: 0 }}>
                  <div className="jf-meta__row">
                    <dt>Type</dt>
                    <dd>{item.type}</dd>
                  </div>
                  <div className="jf-meta__row">
                    <dt>Permalink</dt>
                    <dd>{publicHref}</dd>
                  </div>
                  <div className="jf-meta__row">
                    <dt>ID</dt>
                    <dd>{item.id}</dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="jf-card">
              <div className="jf-card__body">
                <button className="jf-btn jf-btn--danger jf-btn--block" onClick={deleteItem}>
                  {t("common.delete")}
                </button>
                <p className="jf-field__hint" style={{ margin: "0.6rem 0 0", textAlign: "center" }}>
                  This cannot be undone.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------- pieces --- */

function Topbar({
  onBack, backLabel, children,
}: {
  onBack: () => void;
  backLabel: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="jf-topbar">
      <button className="jf-btn jf-btn--quiet" onClick={onBack}>← {backLabel}</button>
      {children}
    </header>
  );
}

function SaveState({
  saving, saved, dirty, error, t,
}: {
  saving: boolean;
  saved: boolean;
  dirty: boolean;
  error: string | null;
  t: (key: string) => string;
}) {
  if (saving) return <span className="jf-status jf-status--dirty">{t("common.saving")}…</span>;
  if (error) return <span className="jf-status jf-status--error">Save failed</span>;
  if (saved) return <span className="jf-status jf-status--saved">✓ {t("common.saved")}</span>;
  if (dirty) return <span className="jf-status jf-status--dirty">Unsaved changes</span>;
  return null;
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "published" || status === "archived" ? ` jf-badge--${status}` : "";
  return <span className={`jf-badge${variant}`}>{status}</span>;
}

function EditorSkeleton({ loadingLabel }: { loadingLabel: string }) {
  return (
    <>
      <header className="jf-topbar">
        <div className="jf-skeleton" style={{ width: 180, height: 20 }} />
      </header>
      <div className="jf-page" aria-busy="true" aria-label={loadingLabel}>
        <div className="jf-split">
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div className="jf-skeleton" style={{ height: 190 }} />
            <div className="jf-skeleton" style={{ height: 320 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div className="jf-skeleton" style={{ height: 210 }} />
            <div className="jf-skeleton" style={{ height: 150 }} />
          </div>
        </div>
      </div>
    </>
  );
}
