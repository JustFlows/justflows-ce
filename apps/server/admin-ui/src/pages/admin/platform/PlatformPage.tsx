import { Fragment, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "../../../admin-router";
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
  settings: {
    signupEnabled?: boolean;
    signupDatabaseMode?: "current" | "separate";
    baseDomain?: string;
    signupDatabase?: { host: string; port: number; database: string; username: string; passwordSet: boolean } | null;
    purgeAfterDays?: number;
  } | null;
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

  async function purge(id: string, name: string) {
    if (!window.confirm(t("platform.purgeConfirm", { name }))) return;
    setError("");
    const res = await fetch(`/api/platform/tenants/${id}/purge`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json() as { error?: string };
      setError(body.error ?? t("platform.purgeFailed"));
      return;
    }
    setNotice(t("platform.purged"));
    const next = await fetch("/api/platform/overview");
    if (next.ok) setOverview(await next.json() as Overview);
  }

  async function savePurgeDays(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const purgeAfterDays = Number(form.get("purgeAfterDays"));
    const res = await fetch("/api/platform/settings/purge", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purgeAfterDays }),
    });
    const body = await res.json() as { error?: string; settings?: Overview["settings"] };
    if (!res.ok) setError(body.error ?? t("platform.purgeFailed"));
    else {
      setNotice(t("platform.saved"));
      if (body.settings) setOverview((current) => current ? { ...current, settings: body.settings ?? current.settings } : current);
    }
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
    const signupDatabaseMode = form.get("signupDatabaseMode") === "separate" ? "separate" : "current";
    const database = signupDatabaseMode === "separate"
      ? {
          host: String(form.get("signupDbHost") ?? ""),
          port: Number(form.get("signupDbPort") ?? 5432),
          database: String(form.get("signupDbName") ?? ""),
          username: String(form.get("signupDbUser") ?? ""),
          password: String(form.get("signupDbPassword") ?? ""),
        }
      : undefined;
    const res = await fetch("/api/platform/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        signupEnabled: form.get("signupEnabled") === "on",
        signupDatabaseMode,
        baseDomain: form.get("baseDomain"),
        database,
      }),
    });
    const body = await res.json() as { error?: string; settings?: Overview["settings"] };
    if (!res.ok) setError(body.error ?? "Could not save signup settings");
    else {
      setNotice(t("platform.saved"));
      if (body.settings) setOverview((current) => current ? { ...current, settings: body.settings ?? current.settings } : current);
    }
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
                          <Link to={`/admin/platform/workspaces/${tenant.id}`}>{tenant.name}</Link>
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
                                  <Link to={`/admin/platform/sites/${site.id}`}>{site.hostname ?? site.name}</Link>
                                  <div className="jf-field__hint">
                                    {site.name} · {site.database_choice === "separate" ? t("platform.separate") : site.database_choice === "current" ? t("platform.current") : t("platform.inherit")}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="jf-td--actions">
                          {tenant.status === "deleted" ? (
                            <button type="button" className="jf-btn jf-btn--danger jf-btn--sm" onClick={() => void purge(tenant.id, tenant.name)}>
                              {t("platform.purgeNow")}
                            </button>
                          ) : (
                            <>
                              <button type="button" className="jf-btn jf-btn--sm" aria-expanded={adding} onClick={() => setAddingSiteTo(adding ? null : tenant.id)}>
                                {t("platform.addSite")}
                              </button>{" "}
                              {tenant.status === "suspended" ? (
                                <>
                                  <button type="button" className="jf-btn jf-btn--sm" onClick={() => void act(tenant.id, "reactivate")}>{t("platform.reactivate")}</button>{" "}
                                  <button type="button" className="jf-btn jf-btn--danger jf-btn--sm" onClick={() => void purge(tenant.id, tenant.name)}>{t("platform.purgeNow")}</button>
                                </>
                              ) : (
                                <button type="button" className="jf-btn jf-btn--danger jf-btn--sm" onClick={() => void act(tenant.id, "suspend")}>{t("platform.suspend")}</button>
                              )}
                            </>
                          )}
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
          <h2 className="jf-card__title">{t("platform.purgeTitle")}</h2>
        </div>
        <form key={overview?.settings?.purgeAfterDays ?? 30} className="jf-card__body jf-stack" onSubmit={(event) => void savePurgeDays(event)}>
          <p className="jf-field__hint">{t("platform.purgeHint")}</p>
          <div className="jf-field" style={{ maxWidth: 160 }}>
            <label className="jf-field__label" htmlFor="jf-purge-days">{t("platform.purgeDays")}</label>
            <input
              id="jf-purge-days"
              className="jf-input"
              name="purgeAfterDays"
              type="number"
              min={0}
              max={3650}
              required
              defaultValue={overview?.settings?.purgeAfterDays ?? 30}
            />
          </div>
          <div className="jf-row">
            <button className="jf-btn jf-btn--primary" type="submit">{t("common.save")}</button>
          </div>
        </form>
      </section>

      <section className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">{t("platform.signup")}</h2>
        </div>
        <SignupSettingsForm
          settings={overview?.settings}
          hint={t("platform.signupHint")}
          databaseHint={t("platform.signupDatabaseHint")}
          enabledLabel={t("platform.signupEnabled")}
          domainLabel={t("platform.baseDomain")}
          currentLabel={t("platform.current")}
          separateLabel={t("platform.separate")}
          databaseLabel={t("platform.database")}
          passwordKeep={t("platform.passwordKeep")}
          hostLabel={t("platform.host")}
          portLabel={t("platform.port")}
          databaseNameLabel={t("platform.databaseName")}
          usernameLabel={t("platform.username")}
          passwordLabel={t("platform.password")}
          openLabel={t("platform.signupOpen")}
          saveLabel={t("common.save")}
          onSubmit={saveSignup}
        />
      </section>
    </div>
  );
}

function readSignupSettings(value: Overview["settings"] | string | null | undefined): {
  signupEnabled: boolean;
  signupDatabaseMode: "current" | "separate";
  baseDomain: string;
  signupDatabase: NonNullable<Overview["settings"]>["signupDatabase"];
} {
  const empty = { signupEnabled: false, signupDatabaseMode: "current" as const, baseDomain: "", signupDatabase: null };
  let raw: unknown = value;
  for (let depth = 0; depth < 2 && typeof raw === "string"; depth += 1) {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return empty;
    }
  }
  if (!raw || typeof raw !== "object") return empty;
  const record = raw as NonNullable<Overview["settings"]>;
  const database = record.signupDatabase;
  return {
    signupEnabled: record.signupEnabled === true,
    signupDatabaseMode: record.signupDatabaseMode === "separate" ? "separate" : "current",
    baseDomain: typeof record.baseDomain === "string" ? record.baseDomain : "",
    signupDatabase: database && typeof database.host === "string" ? database : null,
  };
}

function SignupSettingsForm({
  settings,
  hint,
  databaseHint,
  enabledLabel,
  domainLabel,
  currentLabel,
  separateLabel,
  databaseLabel,
  passwordKeep,
  hostLabel,
  portLabel,
  databaseNameLabel,
  usernameLabel,
  passwordLabel,
  openLabel,
  saveLabel,
  onSubmit,
}: {
  settings: Overview["settings"] | string | null | undefined;
  hint: string;
  databaseHint: string;
  enabledLabel: string;
  domainLabel: string;
  currentLabel: string;
  separateLabel: string;
  databaseLabel: string;
  passwordKeep: string;
  hostLabel: string;
  portLabel: string;
  databaseNameLabel: string;
  usernameLabel: string;
  passwordLabel: string;
  openLabel: string;
  saveLabel: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const signup = readSignupSettings(settings);
  const [databaseMode, setDatabaseMode] = useState<"current" | "separate">(signup.signupDatabaseMode);
  const database = signup.signupDatabase;
  return (
    <form key={`${signup.signupEnabled}:${signup.signupDatabaseMode}:${signup.baseDomain}:${database?.host ?? ""}`} className="jf-card__body jf-stack" onSubmit={onSubmit}>
      <label className="jf-checkrow">
        <input name="signupEnabled" type="checkbox" defaultChecked={signup.signupEnabled} />
        <span>{enabledLabel}</span>
      </label>
      <p className="jf-field__hint">{hint}</p>
      <div className="jf-grid jf-grid--2">
        <Field label={domainLabel}>
          <input className="jf-input jf-input--mono" name="baseDomain" defaultValue={signup.baseDomain} placeholder="example.com" />
        </Field>
      </div>
      <fieldset className="jf-choice">
        <legend className="jf-field__label">{databaseLabel}</legend>
        <label className="jf-checkrow">
          <input type="radio" name="signupDatabaseMode" value="current" checked={databaseMode === "current"} onChange={() => setDatabaseMode("current")} />
          <span>{currentLabel}</span>
        </label>
        <label className="jf-checkrow">
          <input type="radio" name="signupDatabaseMode" value="separate" checked={databaseMode === "separate"} onChange={() => setDatabaseMode("separate")} />
          <span>{separateLabel}</span>
        </label>
      </fieldset>
      {databaseMode === "separate" ? (
        <>
          <p className="jf-field__hint">{databaseHint}</p>
          <div className="jf-grid jf-grid--2">
            <Field label={hostLabel}><input className="jf-input jf-input--mono" name="signupDbHost" required defaultValue={database?.host ?? "localhost"} /></Field>
            <Field label={portLabel}><input className="jf-input jf-input--mono" name="signupDbPort" required defaultValue={String(database?.port ?? 5432)} inputMode="numeric" /></Field>
            <Field label={databaseNameLabel}><input className="jf-input jf-input--mono" name="signupDbName" required defaultValue={database?.database ?? ""} /></Field>
            <Field label={usernameLabel}><input className="jf-input jf-input--mono" name="signupDbUser" required defaultValue={database?.username ?? ""} /></Field>
            <Field label={passwordLabel}>
              <input className="jf-input" name="signupDbPassword" type="password" autoComplete="new-password" placeholder={database?.passwordSet ? passwordKeep : ""} />
            </Field>
          </div>
        </>
      ) : null}
      <p><a href="/signup">{openLabel}</a></p>
      <div className="jf-row">
        <button className="jf-btn jf-btn--primary" type="submit">{saveLabel}</button>
      </div>
    </form>
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
