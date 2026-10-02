import { useEffect, useState, type FormEvent } from "react";
import { useT } from "../../../i18n/I18nProvider";
import { Link } from "../../../admin-router";
import { aiJson, type AiSettings } from "../../../lib/ai-api";
import ProviderCredentialsEditor from "../../../components/ai/ProviderCredentialsEditor";
import AiErrorBoundary from "../../../components/ai/AiErrorBoundary";

/**
 * Admin → Settings → AI: the in-admin assistant's switches and the site-wide
 * provider keys (Anthropic, OpenAI, or any OpenAI-compatible endpoint). The
 * MCP server for external AI apps lives on Settings → API.
 */
export default function AiSettingsPage() {
  const { t } = useT();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    aiJson<AiSettings>("/api/ai/settings", undefined, t("common.requestFailed"))
      .then(setSettings)
      .catch((err: Error) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await aiJson<AiSettings>(
        "/api/ai/settings",
        {
          method: "PUT",
          body: JSON.stringify({
            assistantEnabled: settings.assistantEnabled,
            allowPrivateEndpoints: settings.allowPrivateEndpoints,
            userDailyLimit: settings.userDailyLimit,
          }),
        },
        t("common.requestFailed"),
      );
      setSettings({ ...settings, ...saved });
      setNotice(t("common.saved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("ai.settings.title")}</h1>
          <p>{t("ai.settings.description")}</p>
        </div>
      </header>

      {error && (
        <div className="jf-alert jf-alert--error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="jf-alert jf-alert--success" role="status">
          {notice}
        </div>
      )}

      {!settings ? (
        !error && <p>{t("common.loading")}</p>
      ) : (
        <section className="jf-card">
          <div className="jf-card__head">
            <h2 className="jf-card__title">{t("ai.settings.assistantTitle")}</h2>
          </div>
          <form className="jf-card__body jf-grid" onSubmit={save}>
            <label className="jf-checkrow">
              <input
                type="checkbox"
                checked={settings.assistantEnabled}
                onChange={(e) => setSettings({ ...settings, assistantEnabled: e.target.checked })}
              />
              <span>{t("ai.settings.assistantEnabled")}</span>
            </label>
            <p className="jf-field__hint">{t("ai.settings.assistantHint")}</p>
            <label className="jf-checkrow">
              <input
                type="checkbox"
                checked={settings.allowPrivateEndpoints}
                onChange={(e) => setSettings({ ...settings, allowPrivateEndpoints: e.target.checked })}
              />
              <span>{t("ai.settings.allowPrivate")}</span>
            </label>
            <p className="jf-field__hint">{t("ai.settings.allowPrivateHint")}</p>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-ai-limit">
                {t("ai.settings.dailyLimit")}
              </label>
              <input
                id="jf-ai-limit"
                className="jf-input"
                type="number"
                min={1}
                value={settings.userDailyLimit ?? ""}
                placeholder={t("ai.settings.unlimited")}
                onChange={(e) => setSettings({ ...settings, userDailyLimit: e.target.value ? Number(e.target.value) : null })}
              />
              <p className="jf-field__hint">{t("ai.settings.dailyLimitHint")}</p>
            </div>
            <div>
              <button className="jf-btn jf-btn--primary" type="submit" disabled={saving}>
                {saving ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </form>
        </section>
      )}

      <h2 className="jf-section-title">{t("ai.settings.siteKeys")}</h2>
      <p className="jf-field__hint">{t("ai.settings.siteKeysHint")}</p>
      <AiErrorBoundary>
        <ProviderCredentialsEditor scope="site" />
      </AiErrorBoundary>

      <p className="jf-field__hint">
        {t("ai.settings.mcpPointer")} <Link to="/admin/settings/api">{t("nav.apiKeys")}</Link>
      </p>
    </div>
  );
}
