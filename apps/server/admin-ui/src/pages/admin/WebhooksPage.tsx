import { useEffect, useState, type FormEvent } from "react";
import { useT } from "../../i18n/I18nProvider";

type Endpoint = { id: string; name: string; url: string; events: string[]; active: boolean };
type Delivery = {
  id: string;
  endpoint_id: string;
  endpoint_name: string;
  event: string;
  status: string;
  attempt_count: number;
  response_status: number | null;
  error: string | null;
  created_at: string;
};
type FormState = { name: string; url: string; events: string[]; active: boolean };
const EMPTY: FormState = { name: "", url: "", events: [], active: true };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error((body as { error?: string } | null)?.error ?? "Request failed");
  return body as T;
}

export default function WebhooksPage() {
  const { t } = useT();
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    const [config, history] = await Promise.all([
      json<{ endpoints: Endpoint[]; eventTypes: string[] }>("/api/webhooks"),
      json<{ deliveries: Delivery[] }>("/api/webhooks/deliveries/history"),
    ]);
    setEndpoints(config.endpoints);
    setEventTypes(config.eventTypes);
    setDeliveries(history.deliveries);
  }
  useEffect(() => {
    void load()
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function edit(value: Endpoint) {
    setEditing(value.id);
    setForm({ name: value.name, url: value.url, events: value.events, active: value.active });
    setSecret("");
  }
  function reset() {
    setEditing(null);
    setForm(EMPTY);
  }
  function toggleEvent(event: string) {
    setForm((old) => ({
      ...old,
      events: old.events.includes(event)
        ? old.events.filter((item) => item !== event)
        : [...old.events, event],
    }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (editing)
        await json(`/api/webhooks/${editing}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(form),
        });
      else {
        const value = await json<{ secret: string }>("/api/webhooks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(form),
        });
        setSecret(value.secret);
      }
      reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSaving(false);
    }
  }

  async function rotate(id: string) {
    if (!confirm(t("webhooks.rotateConfirm"))) return;
    const value = await json<{ secret: string }>(`/api/webhooks/${id}/rotate-secret`, {
      method: "POST",
    });
    setSecret(value.secret);
  }
  async function remove(id: string) {
    if (!confirm(t("webhooks.deleteConfirm"))) return;
    await json(`/api/webhooks/${id}`, { method: "DELETE" });
    await load();
  }
  async function redeliver(id: string) {
    await json(`/api/webhooks/deliveries/${id}/redeliver`, { method: "POST" });
    await load();
  }

  if (loading) return <p>{t("common.loading")}</p>;
  return (
    <div className="jf-grid">
      <div>
        <h1>{t("webhooks.title")}</h1>
        <p className="jf-field__hint">{t("webhooks.description")}</p>
      </div>
      {error && (
        <div className="jf-alert jf-alert--error" role="alert">
          {error}
        </div>
      )}
      {secret && (
        <div className="jf-alert jf-alert--success" role="status">
          <span>{t("webhooks.secretOnce")}</span>
          <code>{secret}</code>
          <button
            className="jf-btn jf-btn--sm"
            type="button"
            onClick={() => navigator.clipboard.writeText(secret)}
          >
            {t("webhooks.copy")}
          </button>
        </div>
      )}
      <section className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">{editing ? t("webhooks.edit") : t("webhooks.add")}</h2>
        </div>
        <form className="jf-card__body jf-grid" onSubmit={save}>
          <div className="jf-grid jf-grid--2">
            <label className="jf-field">
              <span className="jf-field__label">{t("webhooks.name")}</span>
              <input
                className="jf-input"
                required
                maxLength={120}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="jf-field">
              <span className="jf-field__label">{t("webhooks.url")}</span>
              <input
                className="jf-input"
                required
                type="url"
                placeholder="https://example.com/hooks/justflows"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </label>
          </div>
          <fieldset className="jf-field">
            <legend className="jf-field__label">{t("webhooks.events")}</legend>
            <div className="jf-grid jf-grid--2">
              {eventTypes.map((item) => (
                <label key={item}>
                  <input
                    type="checkbox"
                    checked={form.events.includes(item)}
                    onChange={() => toggleEvent(item)}
                  />{" "}
                  {item}
                </label>
              ))}
            </div>
          </fieldset>
          {editing && (
            <label>
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />{" "}
              {t("common.active")}
            </label>
          )}
          <div>
            <button
              className="jf-btn jf-btn--primary"
              disabled={saving || form.events.length === 0}
            >
              {saving ? t("common.saving") : t("common.save")}
            </button>
            {editing && (
              <button className="jf-btn jf-btn--quiet" type="button" onClick={reset}>
                {t("common.cancel")}
              </button>
            )}
          </div>
        </form>
      </section>
      <section className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">{t("webhooks.endpoints")}</h2>
        </div>
        <div className="jf-card__body--flush jf-tablewrap">
          <table className="jf-table">
            <thead>
              <tr>
                <th>{t("webhooks.name")}</th>
                <th>{t("webhooks.url")}</th>
                <th>{t("webhooks.events")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.length === 0 ? (
                <tr>
                  <td colSpan={4}>{t("webhooks.empty")}</td>
                </tr>
              ) : (
                endpoints.map((item) => (
                  <tr key={item.id}>
                    <td className="jf-td--strong">
                      {item.name}{" "}
                      {!item.active && <span className="jf-badge">{t("common.inactive")}</span>}
                    </td>
                    <td className="jf-td--mono">{item.url}</td>
                    <td>{item.events.join(", ")}</td>
                    <td className="jf-td--actions">
                      <button className="jf-btn jf-btn--sm" onClick={() => edit(item)}>
                        {t("webhooks.edit")}
                      </button>{" "}
                      <button className="jf-btn jf-btn--sm" onClick={() => void rotate(item.id)}>
                        {t("webhooks.rotate")}
                      </button>{" "}
                      <button
                        className="jf-btn jf-btn--danger jf-btn--sm"
                        onClick={() => void remove(item.id)}
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
      <section className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">{t("webhooks.deliveries")}</h2>
        </div>
        <div className="jf-card__body--flush jf-tablewrap">
          <table className="jf-table">
            <thead>
              <tr>
                <th>{t("webhooks.endpoint")}</th>
                <th>{t("webhooks.event")}</th>
                <th>{t("webhooks.status")}</th>
                <th>{t("webhooks.attempts")}</th>
                <th>{t("webhooks.result")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.length === 0 ? (
                <tr>
                  <td colSpan={6}>{t("webhooks.noDeliveries")}</td>
                </tr>
              ) : (
                deliveries.map((item) => (
                  <tr key={item.id}>
                    <td>{item.endpoint_name}</td>
                    <td className="jf-td--mono">{item.event}</td>
                    <td>
                      <span
                        className={`jf-badge ${item.status === "delivered" ? "jf-badge--published" : ""}`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td>{item.attempt_count}</td>
                    <td title={item.error ?? ""}>{item.response_status ?? item.error ?? "—"}</td>
                    <td>
                      <button className="jf-btn jf-btn--sm" onClick={() => void redeliver(item.id)}>
                        {t("webhooks.redeliver")}
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
