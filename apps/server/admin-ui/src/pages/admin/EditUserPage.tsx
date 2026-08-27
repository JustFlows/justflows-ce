import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: string;
  createdAt: string;
}

const ROLES = ["administrator", "editor", "author", "contributor", "subscriber"];

function fromApi(user: Record<string, string>): User {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    createdAt: user.created_at,
  };
}

export default function EditUserPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [user, setUser] = useState<User | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("subscriber");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);

  useEffect(() => {
    fetch(`/api/users/${encodeURIComponent(id ?? "")}`)
      .then(async (res) => {
        const data = await res.json() as { user?: Record<string, string>; error?: string };
        if (!res.ok || !data.user) throw new Error(data.error ?? "Failed to load user");
        const loaded = fromApi(data.user);
        setUser(loaded);
        setDisplayName(loaded.displayName);
        setRole(loaded.role);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [id]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, role }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to update user");
      setUser((current) => (current ? { ...current, displayName, role } : current));
      setNotice("User updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    setResettingPassword(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(user.id)}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to reset password");
      setNewPassword("");
      setShowPasswordReset(false);
      setNotice("Password reset. The user has been signed out everywhere.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResettingPassword(false);
    }
  }

  async function removeUser() {
    if (!user) return;
    if (!window.confirm(`Remove ${user.displayName || user.email}? This cannot be undone.`)) return;
    setRemoving(true);
    setError("");
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to remove user");
      navigate("/admin/users");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRemoving(false);
    }
  }

  if (loading) {
    return (
      <>
        <header className="jf-topbar">
          <button className="jf-btn jf-btn--quiet" onClick={() => navigate("/admin/users")}>← Back</button>
        </header>
        <div className="jf-page">Loading user…</div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <header className="jf-topbar">
          <button className="jf-btn jf-btn--quiet" onClick={() => navigate("/admin/users")}>← Back</button>
        </header>
        <div className="jf-page">
          <div className="jf-alert jf-alert--error" role="alert">{error || "User not found"}</div>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="jf-topbar">
        <button className="jf-btn jf-btn--quiet" onClick={() => navigate("/admin/users")}>← Back</button>
        <div className="jf-topbar__title">
          <span className="jf-topbar__eyebrow">Edit user</span>
          <h1>{user.displayName || user.email}</h1>
        </div>
        <div className="jf-topbar__actions">
          <button className="jf-btn jf-btn--primary" form="jf-edit-user-form" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </header>

      <div className="jf-page">
        {error && <div className="jf-alert jf-alert--error" role="alert">{error}</div>}
        {notice && <div className="jf-alert jf-alert--success" role="status">{notice}</div>}

        <form id="jf-edit-user-form" className="jf-card" onSubmit={save}>
          <div className="jf-card__head">
            <h2 className="jf-card__title">Profile</h2>
          </div>
          <div className="jf-card__body jf-stack">
            <div className="jf-grid jf-grid--2">
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jf-edit-email">Email address</label>
                <input id="jf-edit-email" className="jf-input" type="email" value={user.email} disabled />
              </div>
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jf-edit-username">Username</label>
                <input id="jf-edit-username" className="jf-input" value={`@${user.username}`} disabled />
              </div>
            </div>
            <div className="jf-grid jf-grid--2">
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jf-edit-displayname">Display name</label>
                <input
                  id="jf-edit-displayname"
                  className="jf-input"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jf-edit-role">Role</label>
                <select
                  id="jf-edit-role"
                  className="jf-input"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <span className="jf-field__hint">Joined {user.createdAt.slice(0, 10)}</span>
          </div>
        </form>

        <div className="jf-card">
          <div className="jf-card__head">
            <h2 className="jf-card__title">Password</h2>
          </div>
          <div className="jf-card__body jf-stack">
            {!showPasswordReset ? (
              <div className="jf-row">
                <button type="button" className="jf-btn jf-btn--ghost" onClick={() => setShowPasswordReset(true)}>
                  Reset password
                </button>
              </div>
            ) : (
              <form className="jf-stack" onSubmit={resetPassword}>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jf-edit-newpassword">New password</label>
                  <input
                    id="jf-edit-newpassword"
                    className="jf-input"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <span className="jf-field__hint">This signs the user out everywhere and can&apos;t be undone.</span>
                </div>
                <div className="jf-row">
                  <button className="jf-btn jf-btn--primary" type="submit" disabled={resettingPassword}>
                    {resettingPassword ? "Resetting…" : "Set new password"}
                  </button>
                  <button
                    className="jf-btn jf-btn--ghost"
                    type="button"
                    disabled={resettingPassword}
                    onClick={() => { setShowPasswordReset(false); setNewPassword(""); }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        <div className="jf-card">
          <div className="jf-card__head">
            <h2 className="jf-card__title">Danger zone</h2>
          </div>
          <div className="jf-card__body jf-stack">
            <p className="jf-field__hint">Removing a user permanently deletes their account. This cannot be undone.</p>
            <div className="jf-row">
              <button type="button" className="jf-btn jf-btn--danger" disabled={removing} onClick={removeUser}>
                {removing ? "Removing…" : "Remove user"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
