import { useState } from "react";
import { Link } from "react-router-dom";
import { JustflowsLogo } from "@components/JustflowsLogo";
import { ensureCsrfCookie } from "../lib/csrf";

/**
 * "Forgot password" entry point for both the admin and the public user login.
 *
 * The server answers every request the same way, so this page always shows the
 * same confirmation once submitted — it never reveals whether the address is
 * registered. The guidance under the confirmation covers the case where the site
 * has no working outgoing mail: recovery then goes through an administrator or
 * the documented CLI fallback.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      await ensureCsrfCookie();
      const res = await fetch("/api/auth/password/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (res.status === 429) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Too many requests. Try again later.");
        return;
      }

      // Any other outcome is deliberately indistinguishable.
      setSent(true);
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
          <h1 className="jf-auth__sub">Reset your password</h1>
        </div>

        {sent ? (
          <div className="jf-auth__body">
            <div className="jf-alert jf-alert--success" role="status">
              If an account exists for that address, a reset link is on its way. The link works
              once and expires soon.
            </div>
            <p className="jf-field__hint" style={{ margin: 0 }}>
              No email after a few minutes? Check your spam folder. If your site has no outgoing
              mail configured, ask an administrator to reset your password — they can also do it
              from the command line.
            </p>
            <Link className="jf-btn jf-btn--primary jf-btn--block" to="/login">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="jf-auth__body">
            <p className="jf-field__hint" style={{ margin: 0 }}>
              Enter the email address for your account and we&apos;ll send a link to choose a new
              password.
            </p>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-forgot-email">
                Email address
              </label>
              <input
                id="jf-forgot-email"
                className="jf-input"
                type="email"
                value={email}
                autoComplete="email"
                placeholder="you@example.com"
                required
                onChange={(e) => setEmail(e.target.value)}
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
              {loading ? "Sending…" : "Send reset link →"}
            </button>
            <p className="jf-auth__footer">
              Remembered it? <Link to="/login">Sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
