import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { JustflowsLogo } from "@components/JustflowsLogo";
import { ensureCsrfCookie } from "../lib/csrf";
import { publicAdminPath } from "../admin-path";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [canRegister, setCanRegister] = useState(false);
  // Set once the server says this account has a second factor. The password
  // fields stay filled so the code can be added without retyping them.
  const [totpRequired, setTotpRequired] = useState(false);
  const [totp, setTotp] = useState("");

  useEffect(() => {
    fetch("/api/auth/registration")
      .then((r) => r.json())
      .then((data: { enabled?: boolean }) => setCanRegister(data.enabled === true))
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      await ensureCsrfCookie();
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(totpRequired ? { email, password, totp } : { email, password }),
      });

      const data = (await res.json()) as { error?: string; totpRequired?: boolean; role?: string };

      if (!res.ok) {
        if (data.totpRequired) setTotpRequired(true);
        setError(data.error ?? "Login failed");
        return;
      }

      // A subscriber has no admin capability — send them to the site instead
      // of an admin app that would have nothing for them to do. A full
      // navigation (not client-side routing) so the server's own /admin gate
      // is the one source of truth for this, not a copy of it here.
      window.location.href = data.role === "subscriber" ? "/" : publicAdminPath("/admin");
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="jf-auth">
      <div className="jf-auth__card">
        <div className="jf-auth__head">
          <div className="jf-auth__brand">
            <JustflowsLogo />
            Justflows
          </div>
          <h1 className="jf-auth__sub">Sign in to your site</h1>
        </div>

        <form onSubmit={submit} className="jf-auth__body">
          <div className="jf-field">
            <label className="jf-field__label" htmlFor="jf-email">
              Email address
            </label>
            <input
              id="jf-email"
              className="jf-input"
              type="email"
              value={email}
              autoComplete="email"
              placeholder="admin@example.com"
              required
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {totpRequired ? (
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-totp">
                Authentication code
              </label>
              <input
                id="jf-totp"
                className="jf-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                placeholder="123456"
                value={totp}
                required
                onChange={(e) => setTotp(e.target.value)}
              />
              <small className="jf-field__hint">
                From your authenticator app, or one of your recovery codes.
              </small>
            </div>
          ) : null}

          <div className="jf-field">
            <label className="jf-field__label" htmlFor="jf-password">
              Password
            </label>
            <input
              id="jf-password"
              className="jf-input"
              type="password"
              value={password}
              autoComplete="current-password"
              required
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <div className="jf-alert jf-alert--error" role="alert">
              {error}
            </div>
          )}

          <button className="jf-btn jf-btn--primary jf-btn--block" type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in →"}
          </button>
          {canRegister && (
            <p className="jf-auth__footer">
              Don&apos;t have an account? <Link to="/register">Create one</Link>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
