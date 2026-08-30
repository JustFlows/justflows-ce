import { useCallback, useEffect, useMemo, useState } from "react";
import PageBuilder from "@components/builder/PageBuilder";
import {
  DEFAULT_PAGE_HEADER,
  diffPageHeader,
  mergePageHeaderClient,
  type PageHeaderConfig,
  type SiteHeaderEntryDTO,
  type SiteHeaderLibraryDTO,
} from "../../lib/page-header";

interface ActiveLanguage {
  code: string;
  nativeName?: string;
  isDefault?: boolean;
}

const BASE_LOCALE = "";

function emptyLib(): SiteHeaderLibraryDTO {
  return { version: 1, defaultId: null, entries: [] };
}

function newEntry(name: string): SiteHeaderEntryDTO {
  return {
    id: crypto.randomUUID(),
    name,
    base: { ...DEFAULT_PAGE_HEADER, blocks: [] },
    overrides: {},
  };
}

/**
 * The theme customizer's "Header" tab: manage the site header library — named
 * headers, one marked the site default, each with optional per-locale
 * overrides — and edit the selected one with the shared header builder.
 */
export default function HeaderLibraryEditor() {
  const [lib, setLib] = useState<SiteHeaderLibraryDTO>(emptyLib);
  const [entryId, setEntryId] = useState<string>("");
  const [locale, setLocale] = useState<string>(BASE_LOCALE);
  const [languages, setLanguages] = useState<ActiveLanguage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"" | "saved" | "error">("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/headers")
      .then((r) => r.json())
      .then((body: { library?: SiteHeaderLibraryDTO; draft?: SiteHeaderLibraryDTO | null }) => {
        const next = body.draft ?? body.library ?? emptyLib();
        setLib(next);
        setEntryId(next.defaultId ?? next.entries[0]?.id ?? "");
      })
      .catch(() => setLib(emptyLib()))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/languages/active")
      .then((r) => r.json())
      .then((data: { languages?: ActiveLanguage[] }) => setLanguages(data.languages ?? []))
      .catch(() => setLanguages([]));
  }, []);

  const entry = useMemo(
    () => lib.entries.find((e) => e.id === entryId) ?? null,
    [lib, entryId],
  );

  const effectiveConfig: PageHeaderConfig = useMemo(() => {
    if (!entry) return { ...DEFAULT_PAGE_HEADER, blocks: [] };
    return locale === BASE_LOCALE
      ? entry.base
      : mergePageHeaderClient(entry.base, entry.overrides[locale]);
  }, [entry, locale]);

  const updateEntry = useCallback(
    (id: string, updater: (e: SiteHeaderEntryDTO) => SiteHeaderEntryDTO) => {
      setLib((prev) => ({
        ...prev,
        entries: prev.entries.map((e) => (e.id === id ? updater(e) : e)),
      }));
      setStatus("");
    },
    [],
  );

  const onConfigChange = useCallback(
    (next: PageHeaderConfig) => {
      if (!entry) return;
      if (locale === BASE_LOCALE) {
        updateEntry(entry.id, (e) => ({ ...e, base: next }));
        return;
      }
      const patch = diffPageHeader(entry.base, next);
      updateEntry(entry.id, (e) => {
        const overrides = { ...e.overrides };
        if (Object.keys(patch).length === 0) delete overrides[locale];
        else overrides[locale] = patch;
        return { ...e, overrides };
      });
    },
    [entry, locale, updateEntry],
  );

  function addHeader() {
    const entryEl = newEntry(`Header ${lib.entries.length + 1}`);
    setLib((prev) => ({
      ...prev,
      defaultId: prev.defaultId ?? entryEl.id,
      entries: [...prev.entries, entryEl],
    }));
    setEntryId(entryEl.id);
    setLocale(BASE_LOCALE);
    setStatus("");
  }

  function renameHeader() {
    if (!entry) return;
    const name = window.prompt("Header name", entry.name)?.trim();
    if (!name) return;
    updateEntry(entry.id, (e) => ({ ...e, name: name.slice(0, 120) }));
  }

  function deleteHeader() {
    if (!entry) return;
    if (!window.confirm(`Delete "${entry.name}"? Pages using it fall back to the site default.`)) return;
    setLib((prev) => {
      const entries = prev.entries.filter((e) => e.id !== entry.id);
      return {
        ...prev,
        defaultId: prev.defaultId === entry.id ? (entries[0]?.id ?? null) : prev.defaultId,
        entries,
      };
    });
    setEntryId((prev) => (prev === entry.id ? "" : prev));
    setStatus("");
  }

  function makeDefault() {
    if (!entry) return;
    setLib((prev) => ({ ...prev, defaultId: entry.id }));
    setStatus("");
  }

  function clearLocaleOverride() {
    if (!entry || locale === BASE_LOCALE) return;
    updateEntry(entry.id, (e) => {
      const overrides = { ...e.overrides };
      delete overrides[locale];
      return { ...e, overrides };
    });
  }

  async function save(publish: boolean) {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch("/api/headers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ library: lib, draft: !publish }),
      });
      const body = (await res.json()) as { error?: string; library?: SiteHeaderLibraryDTO };
      if (!res.ok) throw new Error(body.error ?? "Could not save the header");
      if (publish && body.library) {
        setLib(body.library);
        if (!body.library.entries.some((e) => e.id === entryId)) {
          setEntryId(body.library.defaultId ?? body.library.entries[0]?.id ?? "");
        }
      }
      setStatus("saved");
      setTimeout(() => setStatus(""), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="jf-center">Loading headers…</div>;

  const overridden = Boolean(entry && locale !== BASE_LOCALE && entry.overrides[locale]);

  return (
    <div className="jf-customizer">
      <aside
        className="jf-customizer__controls"
        style={{ padding: "1.1rem", display: "flex", flexDirection: "column", gap: "1.4rem" }}
      >
        <div className="jf-field">
          <label className="jf-field__label" htmlFor="jf-header-entry">Header</label>
          <select
            id="jf-header-entry"
            className="jf-input"
            value={entryId}
            onChange={(e) => { setEntryId(e.target.value); setLocale(BASE_LOCALE); }}
          >
            {lib.entries.length === 0 && <option value="">No headers yet</option>}
            {lib.entries.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}{e.id === lib.defaultId ? " · default" : ""}
              </option>
            ))}
          </select>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button type="button" className="jf-btn jf-btn--sm jf-btn--ghost" onClick={addHeader}>New</button>
            {entry && (
              <button type="button" className="jf-btn jf-btn--sm jf-btn--ghost" onClick={renameHeader}>Rename</button>
            )}
            {entry && (
              <button type="button" className="jf-btn jf-btn--sm jf-btn--ghost" onClick={deleteHeader}>Delete</button>
            )}
          </div>
          {entry && entry.id !== lib.defaultId && (
            <button
              type="button"
              className="jf-btn jf-btn--sm jf-btn--block"
              style={{ marginTop: "0.1rem" }}
              onClick={makeDefault}
            >
              Set as site default
            </button>
          )}
          <p className="jf-field__hint">
            {entry?.id === lib.defaultId
              ? "Shown on every page that hasn’t chosen a different header."
              : "Choose this header per page from the dropdown in the page builder."}
          </p>
        </div>

        {entry && languages.length > 1 && (
          <div className="jf-field">
            <span className="jf-field__label">Language</span>
            <div
              role="tablist"
              aria-label="Header language"
              style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={locale === BASE_LOCALE}
                className={`jf-btn jf-btn--sm ${locale === BASE_LOCALE ? "jf-btn--primary" : "jf-btn--ghost"}`}
                onClick={() => setLocale(BASE_LOCALE)}
              >
                Base
              </button>
              {languages.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  role="tab"
                  aria-selected={locale === l.code}
                  className={`jf-btn jf-btn--sm ${locale === l.code ? "jf-btn--primary" : "jf-btn--ghost"}`}
                  onClick={() => setLocale(l.code)}
                  title={entry.overrides[l.code] ? "Overrides the base header" : "Inherits the base header"}
                >
                  {l.nativeName || l.code}{entry.overrides[l.code] ? " •" : ""}
                </button>
              ))}
            </div>
            {locale !== BASE_LOCALE && (
              <div className="jf-field__hint" style={{ display: "flex", flexDirection: "column", gap: "0.4rem", alignItems: "flex-start" }}>
                <span>
                  {overridden
                    ? "Overrides the base header for this language."
                    : "Inherits the base header — edit below to override it."}
                </span>
                {overridden && (
                  <button type="button" className="jf-btn jf-btn--sm jf-btn--ghost" onClick={clearLocaleOverride}>
                    Reset to base
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            paddingTop: "0.9rem",
            borderTop: "1px solid var(--jf-border)",
          }}
        >
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              className="jf-btn jf-btn--ghost"
              style={{ flex: 1 }}
              disabled={saving}
              onClick={() => void save(false)}
            >
              {saving ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              className="jf-btn jf-btn--primary"
              style={{ flex: 1 }}
              disabled={saving}
              onClick={() => void save(true)}
            >
              Publish
            </button>
          </div>
          {status === "saved" && (
            <span className="jf-field__hint" style={{ color: "var(--jf-success)" }}>✓ Saved</span>
          )}
          {status === "error" && (
            <span className="jf-field__hint" style={{ color: "var(--jf-danger)" }}>{error}</span>
          )}
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {entry ? (
          <PageBuilder
            key={`${entry.id}:${locale}`}
            value={{ version: 1, blocks: effectiveConfig.blocks }}
            onChange={() => {}}
            enableHeader
            headerOnly
            isPage
            header={effectiveConfig}
            onHeaderChange={onConfigChange}
          />
        ) : (
          <p className="jf-field__hint" style={{ padding: "1.1rem" }}>
            Create a header to start building.
          </p>
        )}
      </div>
    </div>
  );
}
