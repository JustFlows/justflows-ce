import { useEffect, useState } from "react";
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

interface BuiltinLanguage {
  code: string;
  name: string;
  nativeName: string;
}

export default function LanguagesPage() {
  const { t } = useT();
  // Reading the language list is open to every admin-eligible role; adding,
  // activating, and setting a default are all administrator-only.
  const canManage = useSessionRole() === "administrator";
  const [languages, setLanguages] = useState<Language[]>([]);
  const [builtin, setBuiltin] = useState<BuiltinLanguage[]>([]);
  const [selectedCode, setSelectedCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [langRes, builtinRes] = await Promise.all([
        fetch("/api/languages"),
        fetch("/api/languages/builtin"),
      ]);
      const langData = await langRes.json();
      const builtinData = await builtinRes.json();
      setLanguages(langData.languages ?? []);
      setBuiltin(builtinData.languages ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function addLanguage() {
    if (!selectedCode) return;
    setError(null);
    const res = await fetch("/api/languages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: selectedCode }),
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

  const existingCodes = new Set(languages.map((l) => l.code));
  const available = builtin.filter((b) => !existingCodes.has(b.code));

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
            <p>Add a language below to start publishing translated content.</p>
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
            <div className="jf-row">
              <select
                className="jf-input"
                style={{ maxWidth: 280 }}
                value={selectedCode}
                onChange={(e) => setSelectedCode(e.target.value)}
                aria-label={t("languages.addLanguage")}
              >
                <option value="">—</option>
                {available.map((b) => (
                  <option key={b.code} value={b.code}>{b.nativeName} ({b.code})</option>
                ))}
              </select>
              <button className="jf-btn jf-btn--primary" onClick={addLanguage} disabled={!selectedCode}>
                {t("common.add")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
