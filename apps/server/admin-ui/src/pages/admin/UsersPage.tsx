import { FormEvent, useEffect, useState } from "react";

interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: string;
  createdAt: string;
}

const ROLES = ["administrator", "editor", "author", "contributor", "subscriber"];

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [invite, setInvite] = useState({ email: "", role: "subscriber" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch("/api/users")
      .then(async (res) => {
        const data = await res.json() as { users?: Array<Record<string, string>>; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Failed to load users");
        setUsers((data.users ?? []).map((user) => ({
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.display_name,
          role: user.role,
          createdAt: user.created_at,
        })));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  async function sendInvite(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invite),
      });
      const data = await res.json() as { user?: User; error?: string; warning?: string };
      if (!res.ok || !data.user) throw new Error(data.error ?? "Failed to invite user");
      setUsers((current) => [...current, data.user!]);
      setInvite({ email: "", role: "subscriber" });
      setShowInvite(false);
      setNotice(data.warning ?? "Invitation sent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>Users</h1>
          <p>Manage who has access to your site</p>
        </div>
        <div className="jf-pagehead__actions">
          <button className="jf-btn jf-btn--primary" onClick={() => setShowInvite(true)}>
            + Invite user
          </button>
        </div>
      </header>

      {showInvite && (
        <form className="jf-card" onSubmit={sendInvite}>
          <div className="jf-card__head">
            <h2 className="jf-card__title">Invite a user</h2>
          </div>
          <div className="jf-card__body jf-stack">
            <div className="jf-grid jf-grid--2">
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jf-invite-email">Email address</label>
                <input
                  id="jf-invite-email"
                  className="jf-input"
                  type="email"
                  required
                  placeholder="user@example.com"
                  value={invite.email}
                  onChange={(e) => setInvite((i) => ({ ...i, email: e.target.value }))}
                />
              </div>
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jf-invite-role">Role</label>
                <select
                  id="jf-invite-role"
                  className="jf-input"
                  value={invite.role}
                  onChange={(e) => setInvite((i) => ({ ...i, role: e.target.value }))}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <div className="jf-row">
              <button className="jf-btn jf-btn--primary" type="submit" disabled={saving}>
                {saving ? "Sending…" : "Send invite"}
              </button>
              <button className="jf-btn jf-btn--ghost" type="button" onClick={() => setShowInvite(false)} disabled={saving}>Cancel</button>
            </div>
          </div>
        </form>
      )}

      {error && <div className="jf-alert jf-alert--error" role="alert">{error}</div>}
      {notice && <div className="jf-alert jf-alert--success" role="status">{notice}</div>}

      <div className="jf-card">
        <div className="jf-tablewrap">
          <table className="jf-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Username</th>
                <th>Role</th>
                <th>Joined</th>
                <th><span className="jf-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6}>Loading users…</td></tr>}
              {!loading && users.length === 0 && <tr><td colSpan={6}>No users found.</td></tr>}
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="jf-td--strong">{u.displayName}</td>
                  <td>{u.email}</td>
                  <td className="jf-td--mono">@{u.username}</td>
                  <td>
                    <span className={`jf-badge${u.role === "administrator" ? " jf-badge--info" : ""}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="jf-td--muted">{u.createdAt.slice(0, 10)}</td>
                  <td className="jf-td--actions">
                    {u.role !== "administrator" && (
                      <button className="jf-btn jf-btn--ghost">Remove</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
