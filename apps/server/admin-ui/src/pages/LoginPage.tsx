import { useEffect, useRef, useState } from "react";
import { Link } from "../admin-router";
import { JustflowsLogo } from "@components/JustflowsLogo";
import { ensureCsrfCookie } from "../lib/csrf";
import { publicAdminPath, safeRedirectPath } from "../admin-path";
import { useT } from "../i18n/I18nProvider";
import {
  conditionalMediationAvailable,
  conditionalRequest,
  getPasskey,
  isCancelled,
  passkeysSupported,
  type CredentialJson,
  type RequestOptionsJson,
} from "../lib/webauthn";

type LoginAnswer = {
  error?: string;
  totpRequired?: boolean;
  totpAccepted?: boolean;
  passkeyRequired?: boolean;
  passkeyOptions?: RequestOptionsJson;
  role?: string;
  redirectTo?: string;
};

/** The passkey mark: a person with a key, as browsers and password managers show it. */
function PasskeyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="7.5" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5 1.3 0 2.5.4 3.5 1" />
      <circle cx="18" cy="11.5" r="2.5" />
      <path d="M18 14v6.5M18 17.5h2M18 19.5h1.5" />
    </svg>
  );
}

/**
 * `adminPath` is set on the staff sign-in page under the admin path. It is sent
 * with the credentials: once the admin has been moved, the server only opens a
 * staff session for a request that names the configured path.
 */
export default function LoginPage({ adminPath }: { adminPath?: string } = {}) {
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
  /** Set when the account's second factor can be a passkey; holds the challenge to answer. */
  const [passkeyOptions, setPasskeyOptions] = useState<RequestOptionsJson | null>(null);
  const [canUsePasskeys] = useState(() => passkeysSupported());
  /** False when only a recovery code can stand in for the passkey (a role that requires passkeys). */
  const [totpAccepted, setTotpAccepted] = useState(true);
  const conditional = useRef<ReturnType<typeof conditionalRequest> | null>(null);

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

  /**
   * Offer saved passkeys in the email field's autofill. The browser shows them
   * only when the field is focused, and the request is cancelled before any
   * other passkey prompt starts.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!(await conditionalMediationAvailable()) || cancelled) return;
      const options = await passkeyOptionsForSignIn().catch(() => null);
      if (!options || cancelled) return;
      conditional.current = conditionalRequest(async (signal) => {
        try {
          const credential = await getPasskey(options, signal, true);
          await finishPasskeySignIn(options.ceremonyId, credential);
        } catch (err) {
          if (!isCancelled(err)) setError(t("auth.login.passkeyFailed"));
        }
      });
    })();
    return () => {
      cancelled = true;
      void conditional.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function passkeyOptionsForSignIn(): Promise<RequestOptionsJson> {
    await ensureCsrfCookie();
    const res = await fetch("/api/auth/passkeys/login/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(adminPath ? { adminPath } : {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? t("auth.login.passkeyFailed"));
    return data as RequestOptionsJson;
  }

  function go(data: LoginAnswer) {
    // The server says where to go: the site for a subscriber, otherwise the
    // admin app at whatever path the administrator moved it to. A full
    // navigation (not client-side routing) so the server's own gate is the one
    // source of truth. `publicAdminPath` is only a fall-back for an older
    // server that does not send `redirectTo`.
    // An AI connector's consent screen sent the user here to sign in first;
    // only that one page may be returned to, so `next` is not an open redirect.
    const next = new URLSearchParams(window.location.search).get("next");
    if (next && next.startsWith("/oauth/consent?")) {
      window.location.href = safeRedirectPath(next, "/");
      return;
    }
    window.location.href = safeRedirectPath(
      data.redirectTo,
      data.role === "subscriber" ? "/" : (adminPath ?? publicAdminPath("/admin")),
    );
  }

  async function finishPasskeySignIn(ceremonyId: string, credential: CredentialJson) {
    setLoading(true);
    setError("");
    try {
      await ensureCsrfCookie();
      const res = await fetch("/api/auth/passkeys/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ceremonyId, credential, ...(adminPath ? { adminPath } : {}) }),
      });
      const data = (await res.json()) as LoginAnswer;
      if (!res.ok) {
        setError(data.error ?? t("auth.login.passkeyFailed"));
        return;
      }
      go(data);
    } finally {
      setLoading(false);
    }
  }

  /** Passwordless: the passkey names the account, so no email is needed. */
  async function signInWithPasskey() {
    await conditional.current?.stop();
    setError("");
    try {
      const options = await passkeyOptionsForSignIn();
      const credential = await getPasskey(options);
      await finishPasskeySignIn(options.ceremonyId, credential);
    } catch (err) {
      /** The browser's reason (blocked by policy, wrong RP ID, no passkey) only shows in the console. */
      if (!isCancelled(err)) console.warn("Passkey sign-in failed", err);
      /** Server errors carry our own message; browser DOMExceptions do not read well. */
      if (!isCancelled(err)) setError(err instanceof Error && !(err instanceof DOMException) && err.message ? err.message : t("auth.login.passkeyFailed"));
    }
  }

  /** Second factor after the password: answer the challenge the server issued. */
  async function confirmWithPasskey() {
    if (!passkeyOptions) return;
    await conditional.current?.stop();
    setError("");
    try {
      const credential = await getPasskey(passkeyOptions);
      await submitLogin({ ceremonyId: passkeyOptions.ceremonyId, credential });
    } catch (err) {
      if (!isCancelled(err)) setError(t("auth.login.passkeyFailed"));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await submitLogin();
  }

  async function submitLogin(passkey?: { ceremonyId: string; credential: CredentialJson }) {
    setLoading(true);
    setError("");

    try {
      await ensureCsrfCookie();
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          ...(totpRequired && totp && !passkey ? { totp } : {}),
          ...(passkey ? { passkey } : {}),
          ...(adminPath ? { adminPath } : {}),
        }),
      });

      const data = (await res.json()) as LoginAnswer;

      if (!res.ok) {
        if (data.totpRequired) setTotpRequired(true);
        setTotpAccepted(data.totpAccepted !== false);
        setPasskeyOptions(data.passkeyRequired && data.passkeyOptions ? data.passkeyOptions : null);
        setError(data.error ?? t("auth.login.loginFailed"));
        return;
      }
      go(data);
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
              autoComplete={canUsePasskeys ? "username webauthn" : "email"}
              placeholder="admin@example.com"
              required
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {passkeyOptions && canUsePasskeys ? (
            <div className="jf-field">
              <button className="jf-btn jf-btn--primary jf-btn--block" type="button" onClick={() => void confirmWithPasskey()} disabled={loading}>
                {t("auth.login.passkeyConfirm")}
              </button>
              <small className="jf-field__hint">{t("auth.login.passkeyConfirmHint")}</small>
            </div>
          ) : null}

          {totpRequired ? (
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-totp">
                {totpAccepted ? t("auth.login.totpLabel") : t("auth.login.recoveryLabel")}
              </label>
              <input
                id="jf-totp"
                className="jf-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus={!passkeyOptions}
                placeholder="123456"
                value={totp}
                required={!passkeyOptions}
                onChange={(e) => setTotp(e.target.value)}
              />
              <small className="jf-field__hint">{totpAccepted ? t("auth.login.totpHint") : t("auth.login.recoveryHint")}</small>
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
          {canUsePasskeys && !totpRequired ? (
            <>
              <div className="jf-auth__or" role="separator">
                <span>{t("auth.login.or")}</span>
              </div>
              <button
                className="jf-btn jf-btn--ghost jf-btn--block jf-auth__passkey"
                type="button"
                onClick={() => void signInWithPasskey()}
                disabled={loading}
                aria-describedby="jf-passkey-hint"
              >
                <PasskeyIcon />
                {t("auth.login.passkeySignIn")}
              </button>
              <small id="jf-passkey-hint" className="jf-auth__hint">{t("auth.login.passkeyHint")}</small>
            </>
          ) : null}
          {canReset && (
            <p className="jf-auth__footer">
              <Link to={adminPath ? `${adminPath}/forgot-password` : "/forgot-password"}>{t("auth.forgotPasswordLink")}</Link>
            </p>
          )}
          {canRegister && !adminPath && (
            <p className="jf-auth__footer">
              {t("auth.login.noAccount")} <Link to="/register">{t("auth.login.createAccount")}</Link>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
