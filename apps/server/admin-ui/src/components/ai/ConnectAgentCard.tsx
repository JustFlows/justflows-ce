import { useEffect, useState, type FormEvent } from "react";
import { useT } from "../../i18n/I18nProvider";
import { aiJson, type AiSettings } from "../../lib/ai-api";
import {
  AGENT_CLIENTS,
  CLIENT_NAMES,
  KEY_CLIENTS,
  presetCapabilities,
  setupSnippet,
  SNIPPET_FILE,
  type AgentClient,
  type AgentPreset,
} from "./agent-setup";

/**
 * Settings → API → "AI agents / MCP" and "Connect an AI agent": the MCP switch,
 * the endpoint URL, a public-HTTPS check, a one-click key for a chosen client
 * and capability preset, and copy-ready setup for each client.
 */
export default function ConnectAgentCard({
  manageApiEnabled,
  grantable,
  onKeyCreated,
}: {
  manageApiEnabled: boolean;
  grantable: string[];
  onKeyCreated: () => Promise<void>;
}) {
  const { t } = useT();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [client, setClient] = useState<AgentClient>("cursor");
  const [preset, setPreset] = useState<AgentPreset>("editor");
  const [userTools, setUserTools] = useState(false);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    aiJson<AiSettings>("/api/ai/settings", undefined, t("common.requestFailed"))
      .then((value) => setSettings(value && typeof value.mcpUrl === "string" ? value : null))
      .catch((err: Error) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveMcp(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setBusy(true);
    setError("");
    try {
      const saved = await aiJson<AiSettings>(
        "/api/ai/settings",
        { method: "PUT", body: JSON.stringify({ mcpEnabled: settings.mcpEnabled, mcpRateLimit: settings.mcpRateLimit }) },
        t("common.requestFailed"),
      );
      setSettings({ ...settings, ...saved });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function createKey() {
    const capabilities = presetCapabilities(preset, grantable);
    if (capabilities.length === 0) {
      setError(t("ai.connect.noCapabilities"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await aiJson<{ key: string }>(
        "/api/api-keys",
        {
          method: "POST",
          body: JSON.stringify({
            name: `${CLIENT_NAMES[client]} (${t(`ai.connect.preset.${preset}`)})`,
            capabilities,
            mcpUserTools: userTools && capabilities.includes("users:manage"),
          }),
        },
        t("common.requestFailed"),
      );
      setSecret(created.key);
      await onKeyCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string, what: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(what);
      window.setTimeout(() => setCopied(""), 2000);
    });
  }

  if (!settings) {
    return error ? (
      <div className="jf-alert jf-alert--error" role="alert">
        {error}
      </div>
    ) : null;
  }

  const usesKey = KEY_CLIENTS.has(client);
  const snippet = setupSnippet(client, settings.mcpUrl, secret || "jfk_…");
  const live = settings.mcpEnabled && manageApiEnabled;

  return (
    <>
      <section className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">{t("ai.connect.mcpTitle")}</h2>
          <span className={`jf-badge ${live ? "jf-badge--published" : "jf-badge--archived"}`}>
            {live ? t("ai.connect.on") : t("ai.connect.off")}
          </span>
        </div>
        <form className="jf-card__body jf-grid" onSubmit={saveMcp}>
          {error && (
            <div className="jf-alert jf-alert--error" role="alert">
              {error}
            </div>
          )}
          <label className="jf-checkrow">
            <input type="checkbox" checked={settings.mcpEnabled} onChange={(e) => setSettings({ ...settings, mcpEnabled: e.target.checked })} />
            <span>{t("ai.connect.enable")}</span>
          </label>
          <p className="jf-field__hint">{t("ai.connect.enableHint")}</p>
          {!manageApiEnabled && <div className="jf-alert jf-alert--error">{t("ai.connect.needsManageApi")}</div>}
          <div className="jf-field">
            <label className="jf-field__label" htmlFor="jf-mcp-rate">
              {t("ai.connect.rateLimit")}
            </label>
            <input
              id="jf-mcp-rate"
              className="jf-input"
              type="number"
              min={1}
              value={settings.mcpRateLimit ?? ""}
              placeholder={t("ai.connect.rateLimitDefault")}
              onChange={(e) => setSettings({ ...settings, mcpRateLimit: e.target.value ? Number(e.target.value) : null })}
            />
          </div>
          <div>
            <button className="jf-btn jf-btn--primary" type="submit" disabled={busy}>
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </form>
      </section>

      <section className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">{t("ai.connect.title")}</h2>
        </div>
        <div className="jf-card__body jf-grid">
          <p className="jf-field__hint">{t("ai.connect.intro")}</p>
          <div className="jf-field">
            <span className="jf-field__label">{t("ai.connect.url")}</span>
            <div className="jf-inputgroup">
              <input className="jf-input" readOnly value={settings.mcpUrl} aria-label={t("ai.connect.url")} />
              <button className="jf-btn" type="button" onClick={() => copy(settings.mcpUrl, "url")}>
                {copied === "url" ? t("ai.connect.copied") : t("apiKeys.copy")}
              </button>
            </div>
          </div>
          {!settings.publicHttps && (
            <div className="jf-banner jf-banner--warn" role="note">
              <div>
                <div className="jf-banner__title">{t("ai.connect.httpsTitle")}</div>
                <div className="jf-banner__sub">{t("ai.connect.httpsBody", { origin: settings.origin })}</div>
              </div>
            </div>
          )}

          <div className="jf-tabs" role="tablist" aria-label={t("ai.connect.client")}>
            {AGENT_CLIENTS.map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={client === item}
                className="jf-tab"
                onClick={() => setClient(item)}
              >
                {CLIENT_NAMES[item]}
              </button>
            ))}
          </div>

          <p>{t(`ai.connect.steps.${client}`)}</p>

          {usesKey && (
            <div className="jf-grid jf-grid--2">
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jf-mcp-preset">
                  {t("ai.connect.presetLabel")}
                </label>
                <select id="jf-mcp-preset" className="jf-input" value={preset} onChange={(e) => setPreset(e.target.value as AgentPreset)}>
                  <option value="editor">{t("ai.connect.preset.editor")}</option>
                  <option value="admin">{t("ai.connect.preset.admin")}</option>
                  <option value="read">{t("ai.connect.preset.read")}</option>
                </select>
                <p className="jf-field__hint">{t(`ai.connect.presetHint.${preset}`)}</p>
              </div>
              <div className="jf-field">
                {grantable.includes("users:manage") && (
                  <label className="jf-checkrow">
                    <input type="checkbox" checked={userTools} onChange={(e) => setUserTools(e.target.checked)} />
                    <span>{t("ai.connect.userTools")}</span>
                  </label>
                )}
                <button className="jf-btn jf-btn--primary" type="button" disabled={busy || !live} onClick={() => void createKey()}>
                  {t("ai.connect.createKey", { client: CLIENT_NAMES[client] })}
                </button>
                {!live && <p className="jf-field__hint">{t("ai.connect.enableFirst")}</p>}
              </div>
            </div>
          )}

          {usesKey && secret && (
            <div className="jf-alert jf-alert--success" role="status">
              {t("apiKeys.secretOnce")}
            </div>
          )}

          <div className="jf-field">
            <span className="jf-field__label">{SNIPPET_FILE[client] ?? t("ai.connect.snippet")}</span>
            <pre className="jf-code-snippet">
              <code>{snippet}</code>
            </pre>
            <div>
              <button className="jf-btn jf-btn--sm" type="button" onClick={() => copy(snippet, "snippet")}>
                {copied === "snippet" ? t("ai.connect.copied") : t("apiKeys.copy")}
              </button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
