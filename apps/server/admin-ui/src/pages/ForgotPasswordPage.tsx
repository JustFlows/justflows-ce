import { useState } from "react";
import { Link } from "../admin-router";
import { JustflowsLogo } from "@components/JustflowsLogo";
import { ensureCsrfCookie } from "../lib/csrf";
import { useT } from "../i18n/I18nProvider";

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
  const { t } = useT();
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
        setError(data.error ?? t("auth.forgotPassword.tooManyRequests"));
        return;
      }

      // Any other outcome is deliberately indistinguishable.
      setSent(true);
    } catch {
      setError(t("auth.unexpectedError"));
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
          <h1 className="jf-auth__sub">{t("auth.forgotPassword.heading")}</h1>
        </div>

        {sent ? (
          <div className="jf-auth__body">
            <div className="jf-alert jf-alert--success" role="status">
              {t("auth.forgotPassword.successMessage")}
            </div>
            <p className="jf-field__hint" style={{ margin: 0 }}>
              {t("auth.forgotPassword.noEmailHint")}
            </p>
            <Link className="jf-btn jf-btn--primary jf-btn--block" to="/login">
              {t("auth.forgotPassword.backToSignIn")}
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="jf-auth__body">
            <p className="jf-field__hint" style={{ margin: 0 }}>
              {t("auth.forgotPassword.instructions")}
            </p>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-forgot-email">
                {t("auth.emailLabel")}
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
              {loading ? t("auth.forgotPassword.sending") : t("auth.forgotPassword.sendCta")}
            </button>
            <p className="jf-auth__footer">
              {t("auth.forgotPassword.rememberedIt")} <Link to="/login">{t("auth.signInLink")}</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
