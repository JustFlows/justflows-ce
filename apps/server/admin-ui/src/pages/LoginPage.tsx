import { useEffect, useState } from "react";
import { Link } from "../admin-router";
import { JustflowsLogo } from "@components/JustflowsLogo";
import { ensureCsrfCookie } from "../lib/csrf";
import { publicAdminPath, safeRedirectPath } from "../admin-path";
import { useT } from "../i18n/I18nProvider";

export default function LoginPage() {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [canRegister, setCanRegister] = useState(false);
  const [canReset, setCanReset] = useState(false);
  // Set once the server says this account has a second factor. The password
  // fields stay filled so the code can be added without retyping them.
  const [totpRequired, setTotpRequired] = useState(false);
  const [totp, setTotp] = useState("");

  useEffect(() => {
    fetch("/api/auth/registration")
      .then((r) => r.json())
      .then((data: { enabled?: boolean }) => setCanRegister(data.enabled === true))
      .catch(() => {});
    fetch("/api/auth/password/forgot")
      .then((r) => r.json())
      .then((data: { enabled?: boolean }) => setCanReset(data.enabled === true))
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

      const data = (await res.json()) as {
        error?: string;
        totpRequired?: boolean;
        role?: string;
        redirectTo?: string;
      };

      if (!res.ok) {
        if (data.totpRequired) setTotpRequired(true);
        setError(data.error ?? t("auth.login.loginFailed"));
        return;
      }

      // The server says where to go: the site for a subscriber, otherwise the
      // admin app at whatever path the administrator moved it to. A full
      // navigation (not client-side routing) so the server's own gate is the one
      // source of truth. `publicAdminPath` is only a fall-back for an older
      // server that does not send `redirectTo`.
      window.location.href = safeRedirectPath(
        data.redirectTo,
        data.role === "subscriber" ? "/" : publicAdminPath("/admin"),
      );
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
          <h1 className="jf-auth__sub">{t("auth.login.heading")}</h1>
        </div>

        <form onSubmit={submit} className="jf-auth__body">
          <div className="jf-field">
            <label className="jf-field__label" htmlFor="jf-email">
              {t("auth.emailLabel")}
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
                {t("auth.login.totpLabel")}
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
              <small className="jf-field__hint">{t("auth.login.totpHint")}</small>
            </div>
          ) : null}

          <div className="jf-field">
            <label className="jf-field__label" htmlFor="jf-password">
              {t("auth.passwordLabel")}
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
            {loading ? t("auth.login.signingIn") : t("auth.signInCta")}
          </button>
          {canReset && (
            <p className="jf-auth__footer">
              <Link to="/forgot-password">{t("auth.forgotPasswordLink")}</Link>
            </p>
          )}
          {canRegister && (
            <p className="jf-auth__footer">
              {t("auth.login.noAccount")} <Link to="/register">{t("auth.login.createAccount")}</Link>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
