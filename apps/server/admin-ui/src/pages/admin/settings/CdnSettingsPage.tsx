// SPDX-License-Identifier: MIT

import { useEffect, useState, type FormEvent } from "react";
import { useSession } from "../../../components/SessionProvider";
import { useT } from "../../../i18n/I18nProvider";

interface CdnField {
  id: string;
  label: string;
  hint: string | null;
  secret: boolean;
  required: boolean;
  maxLength: number;
}

interface CdnProvider {
  id: string;
  label: string;
  docsUrl: string;
  signupUrl: string | null;
  fields: CdnField[];
}

interface CdnConnection {
  provider: string;
  enabled: boolean;
  values: Record<string, string>;
  secrets: Record<string, { last4: string }>;
  updatedAt: string;
}

interface CdnState {
  managedOnPlatform?: boolean;
  canPurge?: boolean;
  providers: CdnProvider[];
  connection: CdnConnection | null;
  environmentFallback: boolean;
}

async function cdnJson<T>(path: string, init: RequestInit | undefined, fallback: string): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? fallback);
  return body as T;
}

/**
 * Admin → Settings → CDN. The platform site stores the connection. A customer
 * site only purges its own hostnames through that connection.
 */
export default function CdnSettingsPage() {
  const { t } = useT();
  const { session, loading: sessionLoading } = useSession();
  const installationRoot = session?.installationRoot === true;
  const [state, setState] = useState<CdnState | null>(null);
  const [providerId, setProviderId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "test" | "remove" | "purge">("");

  function accept(next: CdnState) {
    const providers = next.providers ?? [];
    setState({ ...next, providers, connection: next.connection ?? null, environmentFallback: next.environmentFallback ?? false });
    setProviderId(next.connection?.provider ?? providers[0]?.id ?? "");
    setEnabled(next.connection?.enabled ?? true);
    setValues({ ...(next.connection?.values ?? {}) });
  }

  async function load() {
    accept(await cdnJson<CdnState>("/api/cdn", undefined, t("cdn.failed")));
  }

  useEffect(() => {
    if (sessionLoading) return;
    load().catch((err: Error) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLoading]);

  async function run(kind: typeof busy, action: () => Promise<string>) {
    setBusy(kind);
    setError("");
    setNotice("");
    try {
      setNotice(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cdn.failed"));
    } finally {
      setBusy("");
    }
  }

  const provider = state?.providers.find((item) => item.id === providerId) ?? null;
  const saved = state?.connection?.provider === providerId ? state.connection : null;

  function fieldLabel(field: CdnField): string {
    const key = `cdn.fields.${providerId}.${field.id}`;
    const translated = t(key);
    return translated === key ? field.label : translated;
  }

  function fieldHint(field: CdnField): string | null {
    const key = `cdn.fields.${providerId}.${field.id}Hint`;
    const translated = t(key);
    return translated === key ? field.hint : translated;
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!provider) return;
    void run("save", async () => {
      const body: Record<string, string | null> = {};
      for (const field of provider.fields) {
        const value = values[field.id]?.trim() ?? "";
        // An empty secret keeps the stored one; an empty plain field clears it.
        body[field.id] = field.secret ? value : value || null;
      }
      await cdnJson("/api/cdn", { method: "PUT", body: JSON.stringify({ provider: provider.id, enabled, values: body }) }, t("cdn.failed"));
      await load();
      return t("cdn.saved");
    });
  }

  function test() {
    void run("test", async () => {
      await cdnJson("/api/cdn/test", { method: "POST" }, t("cdn.failed"));
      return t("cdn.testOk", { provider: provider?.label ?? providerId });
    });
  }

  function remove() {
    if (!window.confirm(t("cdn.removeConfirm"))) return;
    void run("remove", async () => {
      await cdnJson("/api/cdn", { method: "DELETE" }, t("cdn.failed"));
      await load();
      return t("cdn.removed");
    });
  }

  function purge() {
    void run("purge", async () => {
      const result = await cdnJson<{ urls: string[] }>("/api/cdn/purge", { method: "POST" }, t("cdn.failed"));
      return t("cdn.purged", { urls: result.urls.join(", ") });
    });
  }

  const canPurge = Boolean(state && (state.connection?.enabled || state.environmentFallback));

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("cdn.title")}</h1>
          <p>{installationRoot ? t("cdn.description") : t("cdn.managedOnPlatform")}</p>
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

      {!state || sessionLoading ? (
        !error && <p>{t("common.loading")}</p>
      ) : !installationRoot ? (
        <section className="jf-card">
          <div className="jf-card__head">
            <h2 className="jf-card__title">{t("cdn.purgeTitle")}</h2>
          </div>
          <div className="jf-card__body jf-grid">
            <p className="jf-field__hint">{state.canPurge ? t("cdn.purgeHint") : t("cdn.purgeUnavailable")}</p>
            <div>
              <button className="jf-btn" type="button" onClick={purge} disabled={busy !== "" || !state.canPurge}>
                {busy === "purge" ? t("cdn.purging") : t("cdn.purge")}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
          {state.environmentFallback && !state.connection?.enabled && (
            <div className="jf-alert jf-alert--info" role="note">
              {t("cdn.environmentFallback")}
            </div>
          )}

          <section className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">{t("cdn.connectionTitle")}</h2>
            </div>
            <form className="jf-card__body jf-grid" onSubmit={save}>
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jf-cdn-provider">
                  {t("cdn.provider")}
                </label>
                <select
                  id="jf-cdn-provider"
                  className="jf-input"
                  value={providerId}
                  onChange={(e) => {
                    setProviderId(e.target.value);
                    setValues(state.connection?.provider === e.target.value ? { ...state.connection.values } : {});
                  }}
                >
                  {state.providers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
                {provider && (
                  <p className="jf-field__hint">
                    <a href={provider.docsUrl} target="_blank" rel="noreferrer noopener">
                      {t("cdn.docs")}
                    </a>
                  </p>
                )}
                {provider?.signupUrl && !saved && (
                  <p className="jf-field__hint">
                    {t("cdn.noAccount")}{" "}
                    <a href={provider.signupUrl} target="_blank" rel="noreferrer noopener sponsored">
                      {t("cdn.signup", { provider: provider.label })}
                    </a>
                  </p>
                )}
              </div>

              {provider?.fields.map((field) => {
                const stored = field.secret ? saved?.secrets[field.id] : undefined;
                const hint = fieldHint(field);
                return (
                  <div className="jf-field" key={field.id}>
                    <label className="jf-field__label" htmlFor={`jf-cdn-${field.id}`}>
                      {fieldLabel(field)}
                    </label>
                    <input
                      id={`jf-cdn-${field.id}`}
                      className="jf-input"
                      type={field.secret ? "password" : "text"}
                      autoComplete="off"
                      maxLength={field.maxLength}
                      required={field.required && !stored}
                      value={values[field.id] ?? ""}
                      placeholder={stored ? t("cdn.secretSaved", { last4: stored.last4 }) : undefined}
                      onChange={(e) => setValues({ ...values, [field.id]: e.target.value })}
                    />
                    {hint && <p className="jf-field__hint">{hint}</p>}
                  </div>
                );
              })}

              <label className="jf-checkrow">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                <span>{t("cdn.enabled")}</span>
              </label>
              <p className="jf-field__hint">{t("cdn.enabledHint")}</p>

              <div className="jf-row">
                <button className="jf-btn jf-btn--primary" type="submit" disabled={busy !== "" || !provider}>
                  {busy === "save" ? t("common.saving") : t("cdn.save")}
                </button>
                {state.connection && (
                  <>
                    <button className="jf-btn" type="button" onClick={test} disabled={busy !== ""}>
                      {busy === "test" ? t("cdn.testing") : t("cdn.test")}
                    </button>
                    <button className="jf-btn jf-btn--danger" type="button" onClick={remove} disabled={busy !== ""}>
                      {t("cdn.remove")}
                    </button>
                  </>
                )}
              </div>
            </form>
          </section>

          <section className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">{t("cdn.purgeTitle")}</h2>
            </div>
            <div className="jf-card__body jf-grid">
              <p className="jf-field__hint">{t("cdn.purgeHint")}</p>
              <div>
                <button className="jf-btn" type="button" onClick={purge} disabled={busy !== "" || !canPurge}>
                  {busy === "purge" ? t("cdn.purging") : t("cdn.purge")}
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
