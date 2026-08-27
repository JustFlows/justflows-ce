import { useEffect, useMemo, useState } from "react";
import { useT } from "../../i18n/I18nProvider";
import { useSessionRole } from "@components/SessionProvider";

interface Language {
  id: string;
  code: string;
  name: string;
  nativeName: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}

function previewNames(code: string): { name: string; nativeName: string } | null {
  const trimmed = code.trim();
  if (trimmed.length < 2) return null;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(trimmed);
    const native = new Intl.DisplayNames([trimmed], { type: "language" }).of(trimmed);
    if (!name) return null;
    return { name, nativeName: native ?? name };
  } catch {
    return null;
  }
}

export default function LanguagesPage() {
  const { t } = useT();
  // Reading the language list is open to every admin-eligible role; adding,
  // activating, and setting a default are all administrator-only.
  const canManage = useSessionRole() === "administrator";
  const [languages, setLanguages] = useState<Language[]>([]);
  const [selectedCode, setSelectedCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const langRes = await fetch("/api/languages");
      const langData = await langRes.json();
      setLanguages(langData.languages ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function addLanguage() {
    const code = selectedCode.trim();
    if (!code) return;
    setError(null);
    const res = await fetch("/api/languages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to add language");
      return;
    }
    setSelectedCode("");
    await load();
  }

  async function setDefault(id: string) {
    await fetch(`/api/languages/${id}/default`, { method: "POST" });
    await load();
  }

  async function toggleActive(lang: Language) {
    await fetch(`/api/languages/${lang.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !lang.isActive }),
    });
    await load();
  }

  async function removeLanguage(lang: Language) {
    if (!window.confirm(t("languages.deleteConfirm", { code: lang.code }))) return;
    setError(null);
    const res = await fetch(`/api/languages/${lang.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Failed to delete language");
      return;
    }
    await load();
  }

  const alreadyAdded = languages.some(
    (lang) => lang.code.toLowerCase() === selectedCode.trim().toLowerCase(),
  );
  const preview = useMemo(() => previewNames(selectedCode), [selectedCode]);
  const canAdd = selectedCode.trim().length >= 2 && !alreadyAdded;

  if (loading) {
    return (
      <div className="jf-page" aria-busy="true" aria-label={t("common.loading")}>
        <div className="jf-skeleton" style={{ height: 44, maxWidth: 260 }} />
        <div className="jf-skeleton" style={{ height: 220 }} />
      </div>
    );
  }

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("languages.title")}</h1>
          <p>{t("languages.subtitle")}</p>
        </div>
      </header>

      {error && <div className="jf-alert jf-alert--error" role="alert">{error}</div>}

      <div className="jf-card">
        {languages.length === 0 ? (
          <div className="jf-empty">
            <span className="jf-empty__icon" aria-hidden="true">🌐</span>
            <span className="jf-empty__title">{t("languages.noLanguages")}</span>
          </div>
        ) : (
          <div className="jf-tablewrap">
            <table className="jf-table">
              <thead>
                <tr>
                  <th>{t("languages.code")}</th>
                  <th>{t("languages.name")}</th>
                  <th>{t("languages.nativeName")}</th>
                  {canManage && <th style={{ textAlign: "end" }}>{t("common.actions")}</th>}
                </tr>
              </thead>
              <tbody>
                {languages.map((lang) => (
                  <tr key={lang.id}>
                    <td><code className="jf-code">{lang.code}</code></td>
                    <td className="jf-td--strong">
                      {lang.name}
                      {lang.isDefault && (
                        <span className="jf-badge jf-badge--info" style={{ marginInlineStart: "0.5rem" }}>
                          {t("common.default")}
                        </span>
                      )}
                    </td>
                    <td>{lang.nativeName}</td>
                    {canManage && (
                      <td className="jf-td--actions">
                        {!lang.isDefault && (
                          <span className="jf-row" style={{ justifyContent: "flex-end" }}>
                            <button className="jf-btn jf-btn--ghost" onClick={() => setDefault(lang.id)}>
                              {t("languages.setDefault")}
                            </button>
                            <button className="jf-btn jf-btn--ghost" onClick={() => toggleActive(lang)}>
                              {lang.isActive ? t("common.active") : t("common.inactive")}
                            </button>
                            <button className="jf-btn jf-btn--danger" onClick={() => void removeLanguage(lang)}>
                              {t("common.delete")}
                            </button>
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canManage && (
        <div className="jf-card">
          <div className="jf-card__head">
            <h2 className="jf-card__title">{t("languages.addLanguage")}</h2>
          </div>
          <div className="jf-card__body">
            <div className="jf-field" style={{ maxWidth: 320 }}>
              <label className="jf-field__label" htmlFor="jf-language-code">{t("languages.code")}</label>
              <div className="jf-row">
                <input
                  id="jf-language-code"
                  className="jf-input jf-input--mono"
                  value={selectedCode}
                  onChange={(e) => setSelectedCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addLanguage();
                    }
                  }}
                  placeholder={t("languages.codePlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={20}
                />
                <button className="jf-btn jf-btn--primary" onClick={addLanguage} disabled={!canAdd}>
                  {t("common.add")}
                </button>
              </div>
              <p className="jf-field__hint">{t("languages.codeHint")}</p>
              {preview && (
                <p className="jf-field__hint">
                  {preview.name} · {preview.nativeName}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
