import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "../admin-router";
import { JustflowsLogo } from "@components/JustflowsLogo";
import { ensureCsrfCookie } from "../lib/csrf";
import { useT } from "../i18n/I18nProvider";

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
  const { t } = useT();
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
      setError(t("auth.resetPassword.minLength", { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setError(t("auth.resetPassword.mismatch"));
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
        setError(data.error ?? t("auth.resetPassword.resetFailed"));
        return;
      }

      setPhase("done");
      window.setTimeout(() => navigate("/login"), 2500);
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
          <h1 className="jf-auth__sub">{t("auth.resetPassword.heading")}</h1>
        </div>

        {phase === "checking" && (
          <div className="jf-auth__body">
            <div className="jf-skeleton" style={{ height: 160 }} />
          </div>
        )}

        {phase === "invalid" && (
          <div className="jf-auth__body">
            <div className="jf-alert jf-alert--error" role="alert">
              {t("auth.resetPassword.invalidLink")}
            </div>
            <Link className="jf-btn jf-btn--primary jf-btn--block" to="/forgot-password">
              {t("auth.resetPassword.requestNewLink")}
            </Link>
          </div>
        )}

        {phase === "done" && (
          <div className="jf-auth__body">
            <div className="jf-alert jf-alert--success" role="status">
              {t("auth.resetPassword.doneMessage")}
            </div>
            <Link className="jf-btn jf-btn--primary jf-btn--block" to="/login">
              {t("auth.resetPassword.signInNow")}
            </Link>
          </div>
        )}

        {phase === "form" && (
          <form onSubmit={submit} className="jf-auth__body">
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-reset-password">
                {t("auth.resetPassword.newPasswordLabel")}
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
                {t("auth.resetPassword.passwordHint", { min: MIN_PASSWORD_LENGTH })}
              </small>
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-reset-confirm">
                {t("auth.resetPassword.confirmPasswordLabel")}
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
              {loading ? t("common.saving") : t("auth.resetPassword.setNewPasswordCta")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
