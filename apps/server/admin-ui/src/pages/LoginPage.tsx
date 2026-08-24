import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { JustflowsLogo } from "@components/JustflowsLogo";
import { ensureCsrfCookie } from "../lib/csrf";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [canRegister, setCanRegister] = useState(false);

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
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json() as { error?: string };

      if (!res.ok) {
        setError(data.error ?? "Login failed");
        return;
      }

      navigate("/admin");
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
            <label className="jf-field__label" htmlFor="jf-email">Email address</label>
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

          <div className="jf-field">
            <label className="jf-field__label" htmlFor="jf-password">Password</label>
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

          {error && <div className="jf-alert jf-alert--error" role="alert">{error}</div>}

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
