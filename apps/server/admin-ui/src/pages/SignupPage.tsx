import { useState, type FormEvent } from "react";
import { Link } from "../admin-router";
import { JustflowsLogo } from "@components/JustflowsLogo";
import { useT } from "../i18n/I18nProvider";
import { ensureCsrfCookie } from "../lib/csrf";

export default function SignupPage() {
  const { t } = useT();
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ url?: string; adminUrl?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    await ensureCsrfCookie();
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        siteName: form.get("siteName"),
        slug: form.get("slug"),
        displayName: form.get("displayName"),
        email: form.get("email"),
        password: form.get("password"),
      }),
    });
    const body = await res.json() as { error?: string; adminUrl?: string; url?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Could not create the site");
      return;
    }
    setDone({ url: body.url, adminUrl: body.adminUrl });
  }

  return (
    <div className="jf-auth">
      <div className="jf-auth__card">
        <div className="jf-auth__head">
          <div className="jf-auth__brand">
            <JustflowsLogo />
            Justflows
          </div>
          <div className="jf-auth__sub">{t("signup.title")}</div>
        </div>

        {done ? (
          <div className="jf-auth__body">
            <div className="jf-alert jf-alert--success" role="status">{t("signup.done")}</div>
            {done.url ? <p className="jf-field__hint" style={{ margin: 0 }}>{done.url}</p> : null}
            {done.adminUrl || done.url ? (
              <a className="jf-btn jf-btn--primary jf-btn--block" href={done.adminUrl ?? done.url}>
                {t("signup.open")}
              </a>
            ) : null}
          </div>
        ) : (
          <form className="jf-auth__body" onSubmit={onSubmit}>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-signup-site">{t("signup.siteName")}</label>
              <input id="jf-signup-site" className="jf-input" name="siteName" required />
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-signup-slug">{t("signup.address")}</label>
              <input id="jf-signup-slug" className="jf-input jf-input--mono" name="slug" required placeholder="my-site" autoCapitalize="off" spellCheck={false} />
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-signup-name">{t("signup.name")}</label>
              <input id="jf-signup-name" className="jf-input" name="displayName" required autoComplete="name" />
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-signup-email">{t("signup.email")}</label>
              <input id="jf-signup-email" className="jf-input" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor="jf-signup-password">{t("signup.password")}</label>
              <input id="jf-signup-password" className="jf-input" name="password" type="password" required minLength={12} autoComplete="new-password" />
            </div>

            {error ? <div className="jf-alert jf-alert--error" role="alert">{error}</div> : null}

            <button className="jf-btn jf-btn--primary jf-btn--block" type="submit" disabled={busy}>
              {busy ? t("signup.creating") : t("signup.submit")}
            </button>
            <p className="jf-auth__footer">
              {t("auth.register.haveAccount")} <Link to="/login">{t("auth.signInLink")}</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
