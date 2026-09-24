import { useEffect, useState } from "react";
import { Link } from "../admin-router";
import { JustflowsLogo } from "@components/JustflowsLogo";
import { publicAdminPath, safeRedirectPath } from "../admin-path";
import { useT } from "../i18n/I18nProvider";

export default function RegisterPage() {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [closed, setClosed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [canReset, setCanReset] = useState(false);

  useEffect(() => {
    fetch("/api/auth/registration")
      .then((r) => r.json())
      .then((data: { enabled?: boolean }) => setClosed(data.enabled !== true))
      .catch(() => setClosed(true))
      .finally(() => setChecking(false));
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
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          username,
          password,
          displayName: displayName.trim() || undefined,
        }),
      });

      const data = (await res.json()) as { error?: string; role?: string; redirectTo?: string };

      if (!res.ok) {
        setError(data.error ?? t("auth.register.registrationFailed"));
        return;
      }

      // The server returns where to land — the site for a subscriber, the admin
      // app (at its configured path) for anyone else. `publicAdminPath` stays as
      // a fall-back for an older server without `redirectTo`.
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
          <div className="jf-auth__sub">
            {checking
              ? t("auth.register.checking")
              : closed
                ? t("auth.register.closedHeading")
                : t("auth.register.heading")}
          </div>
        </div>

        {checking ? (
          <div className="jf-auth__body">
            <div className="jf-skeleton" style={{ height: 180 }} />
          </div>
        ) : closed ? (
          <div className="jf-auth__body">
            <p className="jf-field__hint" style={{ margin: 0 }}>
              {t("auth.register.closedBody")}
            </p>
            <Link className="jf-btn jf-btn--primary jf-btn--block" to="/login">
              {t("auth.signInCta")}
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="jf-auth__body">
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-reg-email">
                {t("auth.emailLabel")}
              </label>
              <input
                id="jf-reg-email"
                className="jf-input"
                type="email"
                value={email}
                autoComplete="email"
                required
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-reg-username">
                {t("auth.register.usernameLabel")}
              </label>
              <input
                id="jf-reg-username"
                className="jf-input"
                value={username}
                autoComplete="username"
                required
                minLength={2}
                maxLength={60}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-reg-name">
                {t("auth.register.displayNameLabel")}{" "}
                <span className="jf-field__hint">{t("auth.register.optionalHint")}</span>
              </label>
              <input
                id="jf-reg-name"
                className="jf-input"
                value={displayName}
                autoComplete="name"
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-reg-password">
                {t("auth.passwordLabel")}
              </label>
              <input
                id="jf-reg-password"
                className="jf-input"
                type="password"
                value={password}
                autoComplete="new-password"
                required
                minLength={8}
                onChange={(e) => setPassword(e.target.value)}
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
              {loading ? t("auth.register.creatingAccount") : t("auth.register.createAccountCta")}
            </button>
            <p className="jf-auth__footer">
              {t("auth.register.haveAccount")} <Link to="/login">{t("auth.signInLink")}</Link>
              {canReset && (
                <>
                  {" · "}
                  <Link to="/forgot-password">{t("auth.forgotPasswordLink")}</Link>
                </>
              )}
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
