import { useState } from "react";

interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: string;
  createdAt: string;
}

const MOCK_USERS: User[] = [
  { id: "1", email: "admin@example.com", username: "admin", displayName: "Site Admin", role: "administrator", createdAt: "2026-08-19" },
];

const ROLES = ["administrator", "editor", "author", "contributor", "subscriber"];

export default function UsersPage() {
  const [users] = useState<User[]>(MOCK_USERS);
  const [showInvite, setShowInvite] = useState(false);
  const [invite, setInvite] = useState({ email: "", role: "subscriber" });

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
        <div className="jf-card">
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
              <button className="jf-btn jf-btn--primary">Send invite</button>
              <button className="jf-btn jf-btn--ghost" onClick={() => setShowInvite(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

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
                  <td className="jf-td--muted">{u.createdAt}</td>
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
