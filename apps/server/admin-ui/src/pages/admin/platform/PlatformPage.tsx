import { Fragment, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useT } from "../../../i18n/I18nProvider";
import { initialJson } from "../../../ssr-data";

interface Overview {
  tenants: Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
    user_mode: string;
    database_mode: string;
  }>;
  sites: Array<{ id: string; tenant_id: string; name: string; hostname: string | null; status: string; database_choice: string }>;
  databases: Array<{ id: string; tenant_id: string; mode: string; status: string; database_name: string | null; host: string | null }>;
  settings: { signupEnabled?: boolean; baseDomain?: string } | null;
}

export default function PlatformPage() {
  const { t } = useT();
  const seeded = initialJson<Overview>("/api/platform/overview");
  const [overview, setOverview] = useState<Overview | null>(seeded ?? null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [databaseMode, setDatabaseMode] = useState<"current" | "separate">("current");
  const [userMode, setUserMode] = useState<"isolated" | "shared">("isolated");
  const [busy, setBusy] = useState(false);
  const [addingSiteTo, setAddingSiteTo] = useState<string | null>(null);

  useEffect(() => {
    if (seeded) return;
    void fetch("/api/platform/overview")
      .then(async (res) => {
        if (res.status === 403) {
          setError(t("platform.forbidden"));
          return;
        }
        if (!res.ok) throw new Error("Could not load platform");
        const body = await res.json() as Overview;
        setOverview(body);
      })
      .catch(() => setError(t("platform.forbidden")));
  }, [seeded, t]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const database = databaseMode === "separate"
      ? {
          host: String(form.get("dbHost") ?? ""),
          port: Number(form.get("dbPort") ?? 5432),
          database: String(form.get("dbName") ?? ""),
          username: String(form.get("dbUser") ?? ""),
          password: String(form.get("dbPassword") ?? ""),
        }
      : undefined;
    const res = await fetch("/api/platform/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        siteName: form.get("siteName"),
        hostname: form.get("hostname"),
        userMode,
        databaseMode,
        admin: {
          email: form.get("email"),
          username: form.get("username"),
          displayName: form.get("displayName"),
          password: form.get("password"),
        },
        database,
      }),
    });
    const body = await res.json() as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Could not create the workspace");
      return;
    }
    setNotice(t("platform.saved"));
    const next = await fetch("/api/platform/overview");
    if (next.ok) setOverview(await next.json() as Overview);
  }

  async function act(id: string, action: "suspend" | "reactivate") {
    setError("");
    const res = await fetch(`/api/platform/tenants/${id}/${action}`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json() as { error?: string };
      setError(body.error ?? "Could not update the workspace");
      return;
    }
    const next = await fetch("/api/platform/overview");
    if (next.ok) setOverview(await next.json() as Overview);
  }

  async function saveSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const res = await fetch("/api/platform/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        signupEnabled: form.get("signupEnabled") === "on",
        baseDomain: form.get("baseDomain"),
      }),
    });
    const body = await res.json() as { error?: string };
    if (!res.ok) setError(body.error ?? "Could not save signup settings");
    else setNotice(t("platform.saved"));
  }

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("platform.title")}</h1>
          <p>{t("platform.intro")}</p>
        </div>
      </header>
      {error ? <div className="jf-alert jf-alert--error" role="alert">{error}</div> : null}
      {notice ? <div className="jf-alert jf-alert--success" role="status">{notice}</div> : null}

      <section className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">{t("platform.create")}</h2>
        </div>
        <form className="jf-card__body jf-stack jf-stack--lg" onSubmit={onCreate}>
          <div className="jf-stack">
            <h3 className="jf-section-title">{t("platform.workspace")}</h3>
            <div className="jf-grid jf-grid--2">
              <Field label={t("platform.name")}><input className="jf-input" name="name" required /></Field>
              <Field label={t("platform.siteName")}><input className="jf-input" name="siteName" required /></Field>
              <Field label={t("platform.hostname")}><input className="jf-input jf-input--mono" name="hostname" required placeholder="site-a.localhost" /></Field>
            </div>
            <div className="jf-grid jf-grid--2">
              <fieldset className="jf-choice">
                <legend className="jf-field__label">{t("platform.userMode")}</legend>
                <label className="jf-checkrow"><input type="radio" name="userMode" checked={userMode === "isolated"} onChange={() => setUserMode("isolated")} /><span>{t("platform.isolated")}</span></label>
                <label className="jf-checkrow"><input type="radio" name="userMode" checked={userMode === "shared"} onChange={() => setUserMode("shared")} /><span>{t("platform.shared")}</span></label>
              </fieldset>
              <fieldset className="jf-choice">
                <legend className="jf-field__label">{t("platform.database")}</legend>
                <label className="jf-checkrow"><input type="radio" name="databaseMode" checked={databaseMode === "current"} onChange={() => setDatabaseMode("current")} /><span>{t("platform.current")}</span></label>
                <label className="jf-checkrow"><input type="radio" name="databaseMode" checked={databaseMode === "separate"} onChange={() => setDatabaseMode("separate")} /><span>{t("platform.separate")}</span></label>
              </fieldset>
            </div>
            {databaseMode === "separate" ? <DatabaseFields /> : null}
          </div>
          <div className="jf-stack">
            <h3 className="jf-section-title">{t("platform.administrator")}</h3>
            <AdminFields />
          </div>
          <div className="jf-row">
            <button className="jf-btn jf-btn--primary" type="submit" disabled={busy}>
              {busy ? t("common.saving") : t("platform.create")}
            </button>
          </div>
        </form>
      </section>

      <section className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">{t("platform.workspaces")}</h2>
        </div>
        {overview && overview.tenants.length === 0 ? (
          <div className="jf-empty">
            <div className="jf-empty__title">{t("platform.empty")}</div>
            <p>{t("platform.emptyHint")}</p>
          </div>
        ) : (
          <div className="jf-card__body--flush jf-tablewrap">
            <table className="jf-table">
              <thead>
                <tr>
                  <th>{t("platform.workspace")}</th>
                  <th>{t("platform.status")}</th>
                  <th>{t("platform.userMode")}</th>
                  <th>{t("platform.database")}</th>
                  <th>{t("platform.sites")}</th>
                  <th><span className="jf-sr-only">{t("common.actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {(overview?.tenants ?? []).map((tenant) => {
                  const sites = (overview?.sites ?? []).filter((site) => site.tenant_id === tenant.id);
                  const adding = addingSiteTo === tenant.id;
                  return (
                    <Fragment key={tenant.id}>
                      <tr>
                        <td className="jf-td--strong">
                          {tenant.name}
                          <div className="jf-field__hint">{tenant.slug}</div>
                        </td>
                        <td>
                          <span className={`jf-badge ${tenant.status === "suspended" ? "jf-badge--warn" : tenant.status === "active" ? "jf-badge--ok" : ""}`}>
                            {tenant.status}
                          </span>
                        </td>
                        <td>{tenant.user_mode === "shared" ? t("platform.shared") : t("platform.isolated")}</td>
                        <td>{tenant.database_mode === "separate" ? t("platform.separate") : t("platform.current")}</td>
                        <td>
                          {sites.length === 0 ? <span className="jf-field__hint">—</span> : (
                            <div className="jf-stack jf-stack--sm">
                              {sites.map((site) => (
                                <div key={site.id}>
                                  {site.hostname
                                    ? <a href={`https://${site.hostname}/admin`}>{site.hostname}</a>
                                    : <span className="jf-badge">{site.status}</span>}
                                  <div className="jf-field__hint">
                                    {site.name} · {site.database_choice === "separate" ? t("platform.separate") : site.database_choice === "current" ? t("platform.current") : t("platform.inherit")}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="jf-td--actions">
                          <button type="button" className="jf-btn jf-btn--sm" aria-expanded={adding} onClick={() => setAddingSiteTo(adding ? null : tenant.id)}>
                            {t("platform.addSite")}
                          </button>{" "}
                          {tenant.status === "suspended"
                            ? <button type="button" className="jf-btn jf-btn--sm" onClick={() => void act(tenant.id, "reactivate")}>{t("platform.reactivate")}</button>
                            : <button type="button" className="jf-btn jf-btn--danger jf-btn--sm" onClick={() => void act(tenant.id, "suspend")}>{t("platform.suspend")}</button>}
                        </td>
                      </tr>
                      {adding ? (
                        <tr>
                          <td colSpan={6}>
                            <AddSiteForm
                              tenant={tenant}
                              onCancel={() => setAddingSiteTo(null)}
                              onCreated={async () => {
                                const next = await fetch("/api/platform/overview");
                                if (next.ok) setOverview(await next.json() as Overview);
                                setAddingSiteTo(null);
                                setNotice(t("platform.saved"));
                              }}
                              onError={setError}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">{t("platform.signup")}</h2>
        </div>
        <form className="jf-card__body jf-stack" onSubmit={saveSignup}>
          <label className="jf-checkrow">
            <input name="signupEnabled" type="checkbox" defaultChecked={overview?.settings?.signupEnabled === true} />
            <span>{t("platform.signupEnabled")}</span>
          </label>
          <p className="jf-field__hint">{t("platform.signupHint")}</p>
          <div className="jf-grid jf-grid--2">
            <Field label={t("platform.baseDomain")}>
              <input className="jf-input jf-input--mono" name="baseDomain" defaultValue={overview?.settings?.baseDomain ?? ""} placeholder="example.com" />
            </Field>
          </div>
          <p><a href="/signup">{t("platform.signupOpen")}</a></p>
          <div className="jf-row">
            <button className="jf-btn jf-btn--primary" type="submit">{t("common.save")}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="jf-field">
      <span className="jf-field__label">{label}</span>
      {children}
    </label>
  );
}

function DatabaseFields() {
  const { t } = useT();
  return (
    <div className="jf-grid jf-grid--2">
      <Field label={t("platform.host")}><input className="jf-input jf-input--mono" name="dbHost" required defaultValue="localhost" /></Field>
      <Field label={t("platform.port")}><input className="jf-input jf-input--mono" name="dbPort" required defaultValue="5432" inputMode="numeric" /></Field>
      <Field label={t("platform.databaseName")}><input className="jf-input jf-input--mono" name="dbName" required /></Field>
      <Field label={t("platform.username")}><input className="jf-input jf-input--mono" name="dbUser" required /></Field>
      <Field label={t("platform.password")}><input className="jf-input" name="dbPassword" type="password" /></Field>
    </div>
  );
}

function AdminFields() {
  const { t } = useT();
  return (
    <div className="jf-grid jf-grid--2">
      <Field label={t("platform.email")}><input className="jf-input" name="email" type="email" required /></Field>
      <Field label={t("platform.username")}><input className="jf-input" name="username" required minLength={2} /></Field>
      <Field label={t("platform.displayName")}><input className="jf-input" name="displayName" required /></Field>
      <Field label={t("platform.password")}><input className="jf-input" name="password" type="password" required minLength={12} /></Field>
    </div>
  );
}

function AddSiteForm({
  tenant,
  onCancel,
  onCreated,
  onError,
}: {
  tenant: Overview["tenants"][number];
  onCancel: () => void;
  onCreated: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { t } = useT();
  const shared = tenant.user_mode === "shared";
  const workspaceSeparate = tenant.database_mode === "separate";
  const [choice, setChoice] = useState<"inherit" | "current" | "separate">(
    shared || workspaceSeparate ? "inherit" : "current",
  );
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    onError("");
    const form = new FormData(event.currentTarget);
    const databaseChoice = shared ? "inherit" : choice;
    const database = databaseChoice === "separate"
      ? {
          host: String(form.get("dbHost") ?? ""),
          port: Number(form.get("dbPort") ?? 5432),
          database: String(form.get("dbName") ?? ""),
          username: String(form.get("dbUser") ?? ""),
          password: String(form.get("dbPassword") ?? ""),
        }
      : undefined;
    const admin = shared
      ? undefined
      : {
          email: form.get("email"),
          username: form.get("username"),
          displayName: form.get("displayName"),
          password: form.get("password"),
        };
    const res = await fetch(`/api/platform/tenants/${tenant.id}/sites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        hostname: form.get("hostname"),
        databaseChoice,
        database,
        admin,
      }),
    });
    const body = await res.json() as { error?: string };
    setBusy(false);
    if (!res.ok) {
      onError(body.error ?? "Could not add the site");
      return;
    }
    await onCreated();
  }

  return (
    <form className="jf-stack" onSubmit={onSubmit}>
      <h3 className="jf-section-title">{t("platform.addSite")}</h3>
      <div className="jf-grid jf-grid--2">
        <Field label={t("platform.siteName")}><input className="jf-input" name="name" required /></Field>
        <Field label={t("platform.hostname")}><input className="jf-input jf-input--mono" name="hostname" required placeholder="site-b.localhost" /></Field>
      </div>
      {shared ? <p className="jf-field__hint">{t("platform.sharedStays")}</p> : (
        <fieldset className="jf-choice">
          <legend className="jf-field__label">{t("platform.database")}</legend>
          {workspaceSeparate ? (
            <label className="jf-checkrow">
              <input type="radio" name="databaseChoice" checked={choice === "inherit"} onChange={() => setChoice("inherit")} /><span>{t("platform.workspaceDatabase")}</span>
            </label>
          ) : null}
          <label className="jf-checkrow">
            <input type="radio" name="databaseChoice" checked={choice === "current"} onChange={() => setChoice("current")} /><span>{t("platform.current")}</span>
          </label>
          <label className="jf-checkrow">
            <input type="radio" name="databaseChoice" checked={choice === "separate"} onChange={() => setChoice("separate")} /><span>{t("platform.separate")}</span>
          </label>
        </fieldset>
      )}
      {choice === "separate" && !shared ? <DatabaseFields /> : null}
      {shared ? null : (
        <>
          <h3 className="jf-section-title">{t("platform.administrator")}</h3>
          <AdminFields />
        </>
      )}
      <div className="jf-row">
        <button className="jf-btn jf-btn--primary" type="submit" disabled={busy}>
          {busy ? t("common.saving") : t("platform.addSite")}
        </button>
        <button className="jf-btn jf-btn--quiet" type="button" onClick={onCancel} disabled={busy}>{t("common.cancel")}</button>
      </div>
    </form>
  );
}
