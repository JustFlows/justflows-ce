import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { JustflowsLogo } from "@components/JustflowsLogo";
import { ensureCsrfCookie } from "../lib/csrf";

const MIN_PASSWORD_LENGTH = 12;

type Phase = "checking" | "invalid" | "form" | "done";

/**
 * Redeem an emailed reset link.
 *
 * The token arrives in the query string. It is read once on mount, held only in
 * component state, and stripped from the address bar immediately so it does not
 * sit in history or leak through a Referer header. It is then exchanged for a
 * validity check, and finally submitted with the new password. Success does not
 * sign the user in — they return to /login, where a second factor still applies.
 */
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const tokenRef = useRef<string>("");
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token") ?? "";
    tokenRef.current = token;

    // Drop the token from the URL before anything else can read or forward it.
    if (window.history.replaceState) {
      window.history.replaceState(null, "", window.location.pathname);
    }

    if (!token) {
      setPhase("invalid");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        await ensureCsrfCookie();
        const res = await fetch("/api/auth/password/reset/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = (await res.json().catch(() => ({}))) as { valid?: boolean };
        if (!cancelled) setPhase(res.ok && data.valid ? "form" : "invalid");
      } catch {
        if (!cancelled) setPhase("invalid");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match");
      return;
    }

    setLoading(true);
    try {
      await ensureCsrfCookie();
      const res = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenRef.current, newPassword: password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        if (res.status === 400 && data.error?.includes("expired")) {
          setPhase("invalid");
          return;
        }
        setError(data.error ?? "Could not reset your password");
        return;
      }

      setPhase("done");
      window.setTimeout(() => navigate("/login"), 2500);
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
          <h1 className="jf-auth__sub">Choose a new password</h1>
        </div>

        {phase === "checking" && (
          <div className="jf-auth__body">
            <div className="jf-skeleton" style={{ height: 160 }} />
          </div>
        )}

        {phase === "invalid" && (
          <div className="jf-auth__body">
            <div className="jf-alert jf-alert--error" role="alert">
              This reset link is invalid or has expired. Reset links can only be used once.
            </div>
            <Link className="jf-btn jf-btn--primary jf-btn--block" to="/forgot-password">
              Request a new link
            </Link>
          </div>
        )}

        {phase === "done" && (
          <div className="jf-auth__body">
            <div className="jf-alert jf-alert--success" role="status">
              Your password has been changed and every other session was signed out. Redirecting
              you to sign in…
            </div>
            <Link className="jf-btn jf-btn--primary jf-btn--block" to="/login">
              Sign in now
            </Link>
          </div>
        )}

        {phase === "form" && (
          <form onSubmit={submit} className="jf-auth__body">
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-reset-password">
                New password
              </label>
              <input
                id="jf-reset-password"
                className="jf-input"
                type="password"
                value={password}
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                onChange={(e) => setPassword(e.target.value)}
              />
              <small className="jf-field__hint">
                At least {MIN_PASSWORD_LENGTH} characters. Longer is stronger.
              </small>
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-reset-confirm">
                Confirm new password
              </label>
              <input
                id="jf-reset-confirm"
                className="jf-input"
                type="password"
                value={confirm}
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>

            {error && (
              <div className="jf-alert jf-alert--error" role="alert">
                {error}
              </div>
            )}

            <button
              className="jf-btn jf-btn--primary jf-btn--block"
              type="submit"
              disabled={loading}
            >
              {loading ? "Saving…" : "Set new password →"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
