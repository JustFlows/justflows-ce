import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useNavigate } from "../../../admin-router";
import { useT } from "../../../i18n/I18nProvider";
import { initialJson } from "../../../ssr-data";

interface SiteUser {
  id: string;
  email: string;
  username: string;
  display_name: string;
  role: string;
  created_at: string;
  additionalRoles?: string[];
}

interface SiteUsers {
  site: {
    siteId: string;
    siteName: string;
    tenantName: string;
    userMode: string;
    databaseMode: string;
    separateDatabase: boolean;
  };
  users: SiteUser[];
  roles: Array<{ id: string; label: string }>;
}

interface UserDraft {
  displayName: string;
  role: string;
  password: string;
}

const EMPTY_NEW = { email: "", username: "", displayName: "", password: "", role: "subscriber" };

async function readJson<T>(res: Response): Promise<T & { error?: string }> {
  try {
    return await res.json() as T & { error?: string };
  } catch {
    return {} as T & { error?: string };
  }
}

export default function PlatformSiteUsersPage() {
  const { id } = useParams();
  const { t } = useT();
  const navigate = useNavigate();
  const base = `/api/platform/sites/${encodeURIComponent(id ?? "")}/users`;
  const seeded = initialJson<SiteUsers>(base);
  const [data, setData] = useState<SiteUsers | null>(seeded ?? null);
  const [loading, setLoading] = useState(!seeded);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<UserDraft>({ displayName: "", role: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(EMPTY_NEW);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(base);
      const body = await readJson<SiteUsers>(res);
      if (res.status === 403) throw new Error(t("platform.forbidden"));
      if (!res.ok || !body.users) throw new Error(body.error ?? t("users.failedToLoadUsers"));
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("users.failedToLoadUsers"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (seeded) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  function startEdit(user: SiteUser) {
    setEditing(user.id);
    setDraft({ displayName: user.display_name, role: user.role, password: "" });
    setError("");
    setNotice("");
  }

  async function call(url: string, method: string, payload?: unknown): Promise<boolean> {
    const res = await fetch(url, {
      method,
      headers: payload === undefined ? undefined : { "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    if (res.ok) return true;
    const body = await readJson<Record<string, never>>(res);
    setError(body.error ?? t("platform.siteUsersSaveFailed"));
    return false;
  }

  async function onSave(user: SiteUser) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const patch: { displayName?: string; role?: string } = {};
      if (draft.displayName.trim() && draft.displayName.trim() !== user.display_name) patch.displayName = draft.displayName.trim();
      if (draft.role && draft.role !== user.role) patch.role = draft.role;
      if (Object.keys(patch).length > 0 && !(await call(`${base}/${user.id}`, "PATCH", patch))) return;
      if (draft.password && !(await call(`${base}/${user.id}/password`, "POST", { newPassword: draft.password }))) return;
      setEditing(null);
      setNotice(draft.password ? t("platform.siteUserPasswordReset") : t("platform.saved"));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(user: SiteUser) {
    if (!window.confirm(t("users.deleteUserConfirm", { name: user.display_name || user.email }))) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!(await call(`${base}/${user.id}`, "DELETE"))) return;
      setEditing(null);
      setNotice(t("users.userRemoved"));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!(await call(base, "POST", creating))) return;
      setCreating(EMPTY_NEW);
      setNotice(t("platform.siteUserCreated"));
      await load();
    } finally {
      setBusy(false);
    }
  }

  const goBack = () => navigate(`/admin/platform/sites/${encodeURIComponent(id ?? "")}`);
  const roles = data?.roles ?? [];
  const roleLabel = (role: string) => roles.find((entry) => entry.id === role)?.label ?? role;

  return (
    <>
      <header className="jf-topbar">
        <button type="button" className="jf-btn jf-btn--quiet" onClick={goBack}>← {t("common.back")}</button>
        {data ? (
          <div className="jf-topbar__title">
            <span className="jf-topbar__eyebrow">{data.site.siteName} · {data.site.tenantName}</span>
            <h1>{t("platform.siteUsers")}</h1>
          </div>
        ) : null}
      </header>

      <div className="jf-page">
        {error ? <div className="jf-alert jf-alert--error" role="alert">{error}</div> : null}
        {notice ? <div className="jf-alert jf-alert--success" role="status">{notice}</div> : null}

        {!data ? (
          loading ? <p>{t("users.loadingUsers")}</p> : null
        ) : (
          <div className="jf-split">
            <div className="jf-stack jf-stack--lg">
              <section className="jf-card">
                <div className="jf-card__head">
                  <h2 className="jf-card__title">{t("users.title")}</h2>
                  <span className="jf-badge">{data.users.length}</span>
                </div>
                <div className="jf-card__body--flush jf-tablewrap">
                  <table className="jf-table">
                    <thead>
                      <tr>
                        <th>{t("users.name")}</th>
                        <th>{t("users.email")}</th>
                        <th>{t("users.role")}</th>
                        <th>{t("users.joined")}</th>
                        <th><span className="jf-sr-only">{t("common.actions")}</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.users.length === 0 ? <tr><td colSpan={5}>{t("users.noUsersFound")}</td></tr> : null}
                      {data.users.map((user) => editing === user.id ? (
                        <tr key={user.id}>
                          <td colSpan={5}>
                            <div className="jf-stack">
                              <div className="jf-field__hint">{user.email} · <code>@{user.username}</code></div>
                              <div className="jf-grid jf-grid--2">
                                <Field label={t("users.edit.displayName")}>
                                  <input className="jf-input" value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} />
                                </Field>
                                <Field label={t("users.role")}>
                                  <select className="jf-input" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })}>
                                    {roles.some((role) => role.id === draft.role) ? null : <option value={draft.role}>{draft.role}</option>}
                                    {roles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}
                                  </select>
                                </Field>
                                <Field label={t("platform.siteUserNewPassword")}>
                                  <input
                                    className="jf-input"
                                    type="password"
                                    autoComplete="new-password"
                                    value={draft.password}
                                    onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                                  />
                                  <span className="jf-field__hint">{t("platform.siteUserPasswordHint")}</span>
                                </Field>
                              </div>
                              <div className="jf-row">
                                <button type="button" className="jf-btn jf-btn--primary" disabled={busy} onClick={() => void onSave(user)}>
                                  {busy ? t("common.saving") : t("common.save")}
                                </button>
                                <button type="button" className="jf-btn jf-btn--quiet" disabled={busy} onClick={() => setEditing(null)}>{t("common.cancel")}</button>
                                <button type="button" className="jf-btn jf-btn--danger" disabled={busy} onClick={() => void onDelete(user)}>{t("users.remove")}</button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={user.id}>
                          <td className="jf-td--strong">
                            {user.display_name}
                            <div className="jf-field__hint">@{user.username}</div>
                          </td>
                          <td>{user.email}</td>
                          <td>
                            <span className={`jf-badge${user.role === "administrator" ? " jf-badge--info" : ""}`}>{roleLabel(user.role)}</span>
                            {(user.additionalRoles ?? []).map((extra) => <span key={extra} className="jf-badge">{roleLabel(extra)}</span>)}
                          </td>
                          <td className="jf-td--muted">{String(user.created_at).slice(0, 10)}</td>
                          <td className="jf-td--actions">
                            <button type="button" className="jf-btn jf-btn--quiet jf-btn--sm" disabled={busy} onClick={() => startEdit(user)}>{t("users.editUser")}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <aside className="jf-rail">
              <section className="jf-card">
                <div className="jf-card__head">
                  <h2 className="jf-card__title">{t("platform.siteUserAdd")}</h2>
                </div>
                <form className="jf-card__body jf-stack" onSubmit={(event) => void onCreate(event)}>
                  <Field label={t("users.email")}>
                    <input className="jf-input" type="email" required value={creating.email} onChange={(event) => setCreating({ ...creating, email: event.target.value })} />
                  </Field>
                  <Field label={t("users.username")}>
                    <input className="jf-input jf-input--mono" required minLength={2} maxLength={60} value={creating.username} onChange={(event) => setCreating({ ...creating, username: event.target.value })} />
                  </Field>
                  <Field label={t("users.edit.displayName")}>
                    <input className="jf-input" required value={creating.displayName} onChange={(event) => setCreating({ ...creating, displayName: event.target.value })} />
                  </Field>
                  <Field label={t("users.role")}>
                    <select className="jf-input" value={creating.role} onChange={(event) => setCreating({ ...creating, role: event.target.value })}>
                      {roles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}
                    </select>
                  </Field>
                  <Field label={t("platform.siteUserPassword")}>
                    <input className="jf-input" type="password" autoComplete="new-password" required value={creating.password} onChange={(event) => setCreating({ ...creating, password: event.target.value })} />
                  </Field>
                  <button className="jf-btn jf-btn--primary jf-btn--block" type="submit" disabled={busy}>{t("platform.siteUserAdd")}</button>
                </form>
              </section>

              <section className="jf-card">
                <div className="jf-card__head">
                  <h2 className="jf-card__title">{t("platform.record")}</h2>
                </div>
                <div className="jf-card__body jf-stack">
                  <p className="jf-field__hint">{t("platform.siteUsersWhere")}</p>
                  <dl>
                    <MetaRow label={t("platform.userMode")} value={data.site.userMode === "shared" ? t("platform.shared") : t("platform.isolated")} />
                    <MetaRow label={t("platform.database")} value={data.site.separateDatabase ? t("platform.separate") : t("platform.current")} />
                  </dl>
                  {data.site.userMode === "shared" ? <p className="jf-field__hint">{t("platform.siteUsersShared")}</p> : null}
                </div>
              </section>
            </aside>
          </div>
        )}
      </div>
    </>
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

function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="jf-meta__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
