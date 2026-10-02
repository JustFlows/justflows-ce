import { useEffect, useState } from "react";
import { useT } from "../i18n/I18nProvider";
import { JustflowsLogo } from "../components/JustflowsLogo";
import { ensureCsrfCookie } from "../lib/csrf";

/**
 * The OAuth consent screen for AI connectors (claude.ai, ChatGPT, …) (#159).
 * Shows who is asking, where the answer goes, and what it may do; the user
 * can narrow the permissions but never widen them past their own. Nothing is
 * approved without a signed-in user clicking Allow.
 */

interface ConsentDetails {
  client: { name: string; uri: string | null; redirectUri: string };
  resource: string;
  capabilities: string[];
  canGrantUserTools: boolean;
  user: { email: string };
}

export default function OAuthConsentPage() {
  const { t } = useT();
  const request = typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("request") ?? "");
  const [details, setDetails] = useState<ConsentDetails | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [userTools, setUserTools] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!request) {
      setError(t("ai.consent.invalid"));
      return;
    }
    fetch(`/api/oauth/consent?request=${encodeURIComponent(request)}`)
      .then(async (res) => {
        if (res.status === 401) {
          setNeedsLogin(true);
          return;
        }
        const body = (await res.json().catch(() => ({}))) as ConsentDetails & { error?: string };
        if (!res.ok) throw new Error(body.error ?? t("ai.consent.invalid"));
        setDetails(body);
        setSelected(body.capabilities.filter((capability) => capability !== "users:manage"));
      })
      .catch((err: Error) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError("");
    try {
      await ensureCsrfCookie();
      const res = await fetch("/api/oauth/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request, approve, capabilities: selected, userTools }),
      });
      const body = (await res.json().catch(() => ({}))) as { redirectTo?: string; error?: string };
      if (!res.ok || !body.redirectTo) throw new Error(body.error ?? t("common.requestFailed"));
      window.location.href = body.redirectTo;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
      setBusy(false);
    }
  }

  function toggle(capability: string) {
    setSelected((current) => (current.includes(capability) ? current.filter((c) => c !== capability) : [...current, capability]));
  }

  const loginHref = `/login?next=${encodeURIComponent(`/oauth/consent?request=${encodeURIComponent(request)}`)}`;

  return (
    <div className="jf-auth">
      <div className="jf-auth__card">
        <div className="jf-auth__head">
          <div className="jf-auth__brand">
            <JustflowsLogo />
            Justflows
          </div>
          <h1 className="jf-auth__sub">{t("ai.consent.heading")}</h1>
        </div>
        <div className="jf-auth__body jf-consent">
          {error && (
            <div className="jf-alert jf-alert--error" role="alert">
              {error}
            </div>
          )}
          {needsLogin && (
            <>
              <p>{t("ai.consent.signInFirst")}</p>
              <a className="jf-btn jf-btn--primary jf-btn--block" href={loginHref}>
                {t("ai.consent.signIn")}
              </a>
            </>
          )}
          {details && (
            <>
              <p>
                <strong>{details.client.name}</strong> {t("ai.consent.wants", { email: details.user.email })}
              </p>
              <p className="jf-field__hint">
                {t("ai.consent.redirect")} <code>{details.client.redirectUri}</code>
              </p>
              <p className="jf-field__hint">{t("ai.consent.unverified")}</p>
              <fieldset className="jf-field">
                <legend className="jf-field__label">{t("ai.consent.permissions")}</legend>
                <div className="jf-row">
                  <button type="button" className="jf-btn jf-btn--quiet jf-btn--sm" onClick={() => setSelected(details.capabilities)}>
                    {t("apiKeys.selectAll")}
                  </button>
                  <button
                    type="button"
                    className="jf-btn jf-btn--quiet jf-btn--sm"
                    onClick={() => setSelected(details.capabilities.filter((c) => c.endsWith(":read")))}
                  >
                    {t("ai.consent.readOnly")}
                  </button>
                </div>
                <div className="jf-consent__caps">
                  {details.capabilities.map((capability) => (
                    <label key={capability} className="jf-checkrow">
                      <input type="checkbox" checked={selected.includes(capability)} onChange={() => toggle(capability)} />
                      <span>{capability}</span>
                    </label>
                  ))}
                </div>
                <p className="jf-field__hint">{t("ai.consent.ceiling")}</p>
              </fieldset>
              {details.canGrantUserTools && selected.includes("users:manage") && (
                <label className="jf-checkrow">
                  <input type="checkbox" checked={userTools} onChange={(e) => setUserTools(e.target.checked)} />
                  <span>{t("ai.connect.userTools")}</span>
                </label>
              )}
              <div className="jf-row">
                <button className="jf-btn jf-btn--primary" type="button" disabled={busy || selected.length === 0} onClick={() => void decide(true)}>
                  {t("ai.consent.allow")}
                </button>
                <button className="jf-btn" type="button" disabled={busy} onClick={() => void decide(false)}>
                  {t("ai.consent.deny")}
                </button>
              </div>
            </>
          )}
          {!details && !needsLogin && !error && <p>{t("common.loading")}</p>}
        </div>
      </div>
    </div>
  );
}
