import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useT } from "../../i18n/I18nProvider";

type Scope = {
  contentTypes?: string[];
  locales?: string[];
  ownership?: "any" | "self";
};
type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  capabilities: string[];
  scope: Scope;
  allowedIps: string[];
  allowedOrigins: string[];
  rateLimitPerMin: number | null;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  requestCount: number;
};
type Settings = {
  publicApiEnabled: boolean;
  enabled: boolean;
  rateLimitPerMin: number;
  allowedOrigins: string[];
};
type FormState = {
  name: string;
  capabilities: string[];
  ownership: "any" | "self";
  contentTypes: string;
  locales: string;
  allowedIps: string;
  allowedOrigins: string;
  rateLimitPerMin: string;
  expiresAt: string;
};

const EMPTY: FormState = {
  name: "",
  capabilities: [],
  ownership: "any",
  contentTypes: "",
  locales: "",
  allowedIps: "",
  allowedOrigins: "",
  rateLimitPerMin: "",
  expiresAt: "",
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error((body as { error?: string } | null)?.error ?? "Request failed");
  return body as T;
}

const csv = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export default function ApiKeysPage() {
  const { t } = useT();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings>({
    publicApiEnabled: false,
    enabled: false,
    rateLimitPerMin: 120,
    allowedOrigins: [],
  });
  const [form, setForm] = useState<FormState>(EMPTY);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  async function load() {
    const [keyList, caps, cfg] = await Promise.all([
      json<{ keys: ApiKey[] }>("/api/api-keys"),
      json<{ capabilities: string[] }>("/api/api-keys/capabilities"),
      json<Settings>("/api/api-keys/settings"),
    ]);
    setKeys(keyList.keys);
    setCapabilities(caps.capabilities);
    setSettings(cfg);
  }
  useEffect(() => {
    void load()
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function toggleCap(cap: string) {
    setForm((old) => ({
      ...old,
      capabilities: old.capabilities.includes(cap)
        ? old.capabilities.filter((c) => c !== cap)
        : [...old.capabilities, cap],
    }));
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const scope: Scope = {};
      if (form.ownership === "self") scope.ownership = "self";
      if (csv(form.contentTypes).length) scope.contentTypes = csv(form.contentTypes);
      if (csv(form.locales).length) scope.locales = csv(form.locales);
      const created = await json<{ key: string }>("/api/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          capabilities: form.capabilities,
          scope,
          allowedIps: csv(form.allowedIps),
          allowedOrigins: csv(form.allowedOrigins),
          rateLimitPerMin: form.rateLimitPerMin ? Number(form.rateLimitPerMin) : null,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        }),
      });
      setSecret(created.key);
      setForm(EMPTY);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSaving(false);
    }
  }

  async function rotate(id: string) {
    if (!confirm(t("apiKeys.rotateConfirm"))) return;
    try {
      const res = await json<{ key: string }>(`/api/api-keys/${id}/rotate`, { method: "POST" });
      setSecret(res.key);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }
  async function revoke(id: string) {
    if (!confirm(t("apiKeys.revokeConfirm"))) return;
    try {
      await json(`/api/api-keys/${id}/revoke`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }
  async function remove(id: string) {
    if (!confirm(t("apiKeys.deleteConfirm"))) return;
    try {
      await json(`/api/api-keys/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    setSavingSettings(true);
    setError("");
    try {
      const saved = await json<Settings>("/api/api-keys/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      setSettings(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSavingSettings(false);
    }
  }

  const canSubmit = useMemo(
    () => form.name.trim().length > 0 && form.capabilities.length > 0 && !saving,
    [form, saving],
  );

  if (loading) return <p>{t("common.loading")}</p>;

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("apiKeys.title")}</h1>
          <p>{t("apiKeys.description")}</p>
        </div>
      </header>

      {error && (
        <div className="jf-alert jf-alert--error" role="alert">
          {error}
        </div>
      )}
      {secret && (
        <div className="jf-alert jf-alert--success" role="status">
          <span>{t("apiKeys.secretOnce")}</span>
          <code>{secret}</code>
          <button
            className="jf-btn jf-btn--sm"
            type="button"
            onClick={() => void navigator.clipboard.writeText(secret)}
          >
            {t("apiKeys.copy")}
          </button>
        </div>
      )}

      <section className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">{t("apiKeys.globalTitle")}</h2>
        </div>
        <form className="jf-card__body jf-grid" onSubmit={saveSettings}>
          <label className="jf-checkrow">
            <input
              type="checkbox"
              checked={settings.publicApiEnabled}
              onChange={(e) => setSettings({ ...settings, publicApiEnabled: e.target.checked })}
            />
            <span>{t("apiKeys.publicApi")}</span>
          </label>
          <p className="jf-field__hint">{t("apiKeys.publicApiHint")}</p>
          <label className="jf-checkrow">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
            />
            <span>{t("apiKeys.enabled")}</span>
          </label>
          <p className="jf-field__hint">{t("apiKeys.enabledHint")}</p>
          <div className="jf-grid jf-grid--2">
            <label className="jf-field">
              <span className="jf-field__label">{t("apiKeys.globalRateLimit")}</span>
              <input
                className="jf-input"
                type="number"
                min={1}
                value={settings.rateLimitPerMin}
                onChange={(e) =>
                  setSettings({ ...settings, rateLimitPerMin: Number(e.target.value) || 1 })
                }
              />
            </label>
            <label className="jf-field">
              <span className="jf-field__label">{t("apiKeys.globalOrigins")}</span>
              <input
                className="jf-input"
                value={settings.allowedOrigins.join(", ")}
                onChange={(e) => setSettings({ ...settings, allowedOrigins: csv(e.target.value) })}
              />
            </label>
          </div>
          <div>
            <button className="jf-btn jf-btn--primary" type="submit" disabled={savingSettings}>
              {savingSettings ? t("common.saving") : t("apiKeys.saveSettings")}
            </button>
          </div>
        </form>
      </section>

      <section className="jf-card jf-card--overflow-visible">
        <div className="jf-card__head">
          <h2 className="jf-card__title">{t("apiKeys.add")}</h2>
        </div>
        <form className="jf-card__body jf-grid" onSubmit={create}>
          <label className="jf-field">
            <span className="jf-field__label">{t("apiKeys.name")}</span>
            <input
              className="jf-input"
              required
              maxLength={120}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>

          <fieldset className="jf-field jf-multiselect-field">
            <legend className="jf-field__label">{t("apiKeys.capabilities")}</legend>
            <details className="jf-multiselect">
              <summary className="jf-input" aria-label={t("apiKeys.capabilities")}>
                <span>
                  {form.capabilities.length === 0
                    ? t("apiKeys.chooseCapabilities")
                    : t("apiKeys.selectedCapabilities", { count: form.capabilities.length })}
                </span>
              </summary>
              <div
                className="jf-multiselect__menu"
                role="group"
                aria-label={t("apiKeys.capabilities")}
              >
                <div className="jf-multiselect__actions">
                  <button
                    type="button"
                    className="jf-btn jf-btn--quiet jf-btn--sm"
                    onClick={() => setForm({ ...form, capabilities: [...capabilities] })}
                  >
                    {t("apiKeys.selectAll")}
                  </button>
                  <button
                    type="button"
                    className="jf-btn jf-btn--quiet jf-btn--sm"
                    onClick={() => setForm({ ...form, capabilities: [] })}
                  >
                    {t("apiKeys.clear")}
                  </button>
                </div>
                {capabilities.map((cap) => (
                  <label className="jf-multiselect__option" key={cap}>
                    <input
                      type="checkbox"
                      checked={form.capabilities.includes(cap)}
                      onChange={() => toggleCap(cap)}
                    />
                    <span>{cap}</span>
                  </label>
                ))}
              </div>
            </details>
            {form.capabilities.length > 0 && (
              <div className="jf-multiselect__selected">
                {form.capabilities.map((cap) => (
                  <button
                    type="button"
                    className="jf-chip"
                    key={cap}
                    onClick={() => toggleCap(cap)}
                    title={t("apiKeys.removeCapability", { capability: cap })}
                  >
                    {cap} ×
                  </button>
                ))}
              </div>
            )}
            <p className="jf-field__hint">{t("apiKeys.capabilitiesHint")}</p>
          </fieldset>

          <div className="jf-grid jf-grid--2">
            <label className="jf-field">
              <span className="jf-field__label">{t("apiKeys.ownership")}</span>
              <select
                className="jf-input"
                value={form.ownership}
                onChange={(e) => setForm({ ...form, ownership: e.target.value as "any" | "self" })}
              >
                <option value="any">{t("apiKeys.ownershipAny")}</option>
                <option value="self">{t("apiKeys.ownershipSelf")}</option>
              </select>
            </label>
            <label className="jf-field">
              <span className="jf-field__label">{t("apiKeys.contentTypes")}</span>
              <input
                className="jf-input"
                value={form.contentTypes}
                onChange={(e) => setForm({ ...form, contentTypes: e.target.value })}
              />
            </label>
            <label className="jf-field">
              <span className="jf-field__label">{t("apiKeys.locales")}</span>
              <input
                className="jf-input"
                value={form.locales}
                onChange={(e) => setForm({ ...form, locales: e.target.value })}
              />
            </label>
            <label className="jf-field">
              <span className="jf-field__label">{t("apiKeys.allowedIps")}</span>
              <input
                className="jf-input"
                value={form.allowedIps}
                onChange={(e) => setForm({ ...form, allowedIps: e.target.value })}
              />
            </label>
            <label className="jf-field">
              <span className="jf-field__label">{t("apiKeys.allowedOrigins")}</span>
              <input
                className="jf-input"
                value={form.allowedOrigins}
                onChange={(e) => setForm({ ...form, allowedOrigins: e.target.value })}
              />
            </label>
            <label className="jf-field">
              <span className="jf-field__label">{t("apiKeys.rateLimit")}</span>
              <input
                className="jf-input"
                type="number"
                min={1}
                value={form.rateLimitPerMin}
                onChange={(e) => setForm({ ...form, rateLimitPerMin: e.target.value })}
              />
            </label>
            <label className="jf-field">
              <span className="jf-field__label">{t("apiKeys.expiresAt")}</span>
              <input
                className="jf-input"
                type="datetime-local"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              />
            </label>
          </div>

          <div>
            <button className="jf-btn jf-btn--primary" type="submit" disabled={!canSubmit}>
              {saving ? t("common.saving") : t("apiKeys.add")}
            </button>
          </div>
        </form>
      </section>

      <section className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">{t("apiKeys.list")}</h2>
        </div>
        <div className="jf-card__body--flush jf-tablewrap">
          <table className="jf-table">
            <thead>
              <tr>
                <th>{t("apiKeys.name")}</th>
                <th>{t("apiKeys.prefix")}</th>
                <th>{t("apiKeys.capabilities")}</th>
                <th>{t("apiKeys.lastUsed")}</th>
                <th>{t("apiKeys.requests")}</th>
                <th>{t("apiKeys.expires")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 ? (
                <tr>
                  <td colSpan={7}>{t("apiKeys.empty")}</td>
                </tr>
              ) : (
                keys.map((key) => (
                  <tr key={key.id}>
                    <td className="jf-td--strong">
                      {key.name}{" "}
                      {key.revokedAt && (
                        <span className="jf-badge jf-badge--warn">{t("apiKeys.revoked")}</span>
                      )}
                    </td>
                    <td className="jf-td--mono">{key.keyPrefix}…</td>
                    <td>{key.capabilities.length}</td>
                    <td className="jf-td--muted">{key.lastUsedAt ?? "—"}</td>
                    <td>{key.requestCount}</td>
                    <td className="jf-td--muted">
                      {key.revokedAt ? "—" : (key.expiresAt ?? t("apiKeys.never"))}
                    </td>
                    <td className="jf-td--actions">
                      <button
                        className="jf-btn jf-btn--sm"
                        type="button"
                        disabled={Boolean(key.revokedAt)}
                        onClick={() => void rotate(key.id)}
                      >
                        {t("apiKeys.rotate")}
                      </button>{" "}
                      <button
                        className="jf-btn jf-btn--sm"
                        type="button"
                        disabled={Boolean(key.revokedAt)}
                        onClick={() => void revoke(key.id)}
                      >
                        {t("apiKeys.revoke")}
                      </button>{" "}
                      <button
                        className="jf-btn jf-btn--danger jf-btn--sm"
                        type="button"
                        onClick={() => void remove(key.id)}
                      >
                        {t("common.delete")}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
