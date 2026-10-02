import { useEffect, useState, type FormEvent } from "react";
import { useT } from "../../i18n/I18nProvider";
import {
  aiJson,
  type CredentialScope,
  type ProviderCatalogEntry,
  type ProviderCredential,
  type ProviderId,
} from "../../lib/ai-api";

/**
 * Add, test, and remove AI provider keys for one scope: the site-wide keys
 * (Settings → AI) or the signed-in user's personal keys (Account). A stored
 * key is never shown again — only its last four characters.
 */

interface FormState {
  apiKey: string;
  label: string;
  baseUrl: string;
  organization: string;
  project: string;
  defaultModel: string;
  enabled: boolean;
}

function formFor(credential: ProviderCredential | undefined): FormState {
  return {
    apiKey: "",
    label: credential?.label ?? "",
    baseUrl: credential?.baseUrl ?? "",
    organization: credential?.organization ?? "",
    project: credential?.project ?? "",
    defaultModel: credential?.defaultModel ?? "",
    enabled: credential?.enabled ?? true,
  };
}

function ProviderCard({
  scope,
  entry,
  credential,
  onChanged,
}: {
  scope: CredentialScope;
  entry: ProviderCatalogEntry;
  credential: ProviderCredential | undefined;
  onChanged: () => Promise<void>;
}) {
  const { t } = useT();
  const [form, setForm] = useState<FormState>(() => formFor(credential));
  const [busy, setBusy] = useState<"" | "save" | "test" | "remove">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const base = `/api/ai/providers/${scope}/${entry.id}`;

  useEffect(() => {
    setForm(formFor(credential));
  }, [credential]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setError("");
    setNotice("");
    try {
      await aiJson(base, {
        method: "PUT",
        body: JSON.stringify({
          ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
          label: form.label || null,
          baseUrl: form.baseUrl || null,
          organization: entry.id === "openai" ? form.organization || null : null,
          project: entry.id === "openai" ? form.project || null : null,
          defaultModel: form.defaultModel || null,
          enabled: form.enabled,
        }),
      }, t("common.requestFailed"));
      setNotice(t("ai.providers.saved"));
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusy("");
    }
  }

  async function test() {
    setBusy("test");
    setError("");
    setNotice("");
    try {
      const result = await aiJson<{ models: string[] }>(`${base}/test`, { method: "POST" }, t("common.requestFailed"));
      setNotice(t("ai.providers.testOk", { count: result.models.length }));
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    if (!confirm(t("ai.providers.removeConfirm", { provider: entry.label }))) return;
    setBusy("remove");
    setError("");
    try {
      await aiJson(base, { method: "DELETE" }, t("common.requestFailed"));
      setNotice("");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusy("");
    }
  }

  const needsBaseUrl = entry.id === "openai-compatible";
  const id = (field: string) => `jf-ai-${scope}-${entry.id}-${field}`;

  return (
    <section className="jf-card">
      <div className="jf-card__head">
        <h3 className="jf-card__title">{entry.label}</h3>
        {credential ? (
          <span className={`jf-badge ${credential.enabled ? "jf-badge--published" : "jf-badge--archived"}`}>
            {t("ai.providers.keyEnding", { last4: credential.keyLast4 })}
          </span>
        ) : (
          <span className="jf-badge">{t("ai.providers.notConfigured")}</span>
        )}
      </div>
      <form className="jf-card__body jf-grid" onSubmit={save}>
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
        <div className="jf-grid jf-grid--2">
          <div className="jf-field">
            <label className="jf-field__label" htmlFor={id("key")}>
              {t("ai.providers.apiKey")}
            </label>
            <input
              id={id("key")}
              className="jf-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={form.apiKey}
              placeholder={credential ? t("ai.providers.keepKey") : t("ai.providers.pasteKey")}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
            <p className="jf-field__hint">{t("ai.providers.keyHint")}</p>
          </div>
          <div className="jf-field">
            <label className="jf-field__label" htmlFor={id("base")}>
              {needsBaseUrl ? t("ai.providers.baseUrlRequired") : t("ai.providers.baseUrl")}
            </label>
            <input
              id={id("base")}
              className="jf-input"
              type="url"
              required={needsBaseUrl}
              value={form.baseUrl}
              placeholder={entry.defaultBaseUrl ?? t("ai.providers.baseUrlExample")}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            />
            {needsBaseUrl && <p className="jf-field__hint">{t("ai.providers.compatibleHint")}</p>}
          </div>
          {entry.id === "openai" && (
            <>
              <div className="jf-field">
                <label className="jf-field__label" htmlFor={id("org")}>
                  {t("ai.providers.organization")}
                </label>
                <input id={id("org")} className="jf-input" value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} />
              </div>
              <div className="jf-field">
                <label className="jf-field__label" htmlFor={id("project")}>
                  {t("ai.providers.project")}
                </label>
                <input id={id("project")} className="jf-input" value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} />
              </div>
            </>
          )}
          <div className="jf-field">
            <label className="jf-field__label" htmlFor={id("label")}>
              {t("ai.providers.label")}
            </label>
            <input id={id("label")} className="jf-input" maxLength={120} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </div>
          <div className="jf-field">
            <label className="jf-field__label" htmlFor={id("model")}>
              {t("ai.providers.defaultModel")}
            </label>
            {credential && credential.models.length > 0 ? (
              <select id={id("model")} className="jf-input" value={form.defaultModel} onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}>
                <option value="">{t("ai.providers.chooseModel")}</option>
                {credential.models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id("model")}
                className="jf-input"
                value={form.defaultModel}
                placeholder={t("ai.providers.modelPlaceholder")}
                onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}
              />
            )}
            <p className="jf-field__hint">{t("ai.providers.modelHint")}</p>
          </div>
        </div>
        <label className="jf-checkrow">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          <span>{t("ai.providers.enabled")}</span>
        </label>
        <div className="jf-row">
          <button className="jf-btn jf-btn--primary" type="submit" disabled={busy !== "" || (!credential && !form.apiKey.trim())}>
            {busy === "save" ? t("common.saving") : t("common.save")}
          </button>
          <button className="jf-btn" type="button" disabled={!credential || busy !== ""} onClick={() => void test()}>
            {busy === "test" ? t("ai.providers.testing") : t("ai.providers.test")}
          </button>
          {credential && (
            <button className="jf-btn jf-btn--danger" type="button" disabled={busy !== ""} onClick={() => void remove()}>
              {t("ai.providers.remove")}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

export default function ProviderCredentialsEditor({ scope }: { scope: CredentialScope }) {
  const { t } = useT();
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>([]);
  const [credentials, setCredentials] = useState<ProviderCredential[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    const [providers, stored] = await Promise.all([
      aiJson<{ providers: ProviderCatalogEntry[] }>("/api/ai/providers/catalog", undefined, t("common.requestFailed")),
      aiJson<{ credentials: ProviderCredential[] }>(`/api/ai/providers/${scope}`, undefined, t("common.requestFailed")),
    ]);
    setCatalog(Array.isArray(providers?.providers) ? providers.providers : []);
    setCredentials(Array.isArray(stored?.credentials) ? stored.credentials : []);
  }

  useEffect(() => {
    void load()
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  if (loading) return <p>{t("common.loading")}</p>;
  if (error) {
    return (
      <div className="jf-alert jf-alert--error" role="alert">
        {error}
      </div>
    );
  }
  const byProvider = new Map<ProviderId, ProviderCredential>(credentials.map((item) => [item.provider, item]));
  return (
    <div className="jf-stack">
      {catalog.map((entry) => (
        <ProviderCard key={entry.id} scope={scope} entry={entry} credential={byProvider.get(entry.id)} onChanged={load} />
      ))}
    </div>
  );
}
