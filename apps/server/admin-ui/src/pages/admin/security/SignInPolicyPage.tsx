// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import { LoadError, PageSkeleton, SaveBar, Section } from "./components";
import { useT } from "../../../i18n/I18nProvider";

type Provider = {
  id: string;
  name: string;
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecretSet: boolean;
  scopes: string[];
  allowedDomains: string[];
  mfaAmr: string[];
  mfaAcr: string[];
};

/** A provider as edited: lists as text, and a write-only secret. */
type ProviderDraft = {
  id: string;
  name: string;
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  clientSecretSet: boolean;
  scopes: string;
  allowedDomains: string;
  mfaAmr: string;
  mfaAcr: string;
};

type Payload = {
  mfa: { requiredRoles: string[] };
  providers: Provider[];
  roles: Array<{ id: string; name: string }>;
  callbackBase: string;
};

const MAX_PROVIDERS = 5;
const words = (value: string) => value.split(/[\s,]+/).map((word) => word.trim()).filter(Boolean);

function toDraft(provider: Provider): ProviderDraft {
  return {
    id: provider.id,
    name: provider.name,
    enabled: provider.enabled,
    issuer: provider.issuer,
    clientId: provider.clientId,
    clientSecret: "",
    clientSecretSet: provider.clientSecretSet,
    scopes: provider.scopes.join(" "),
    allowedDomains: provider.allowedDomains.join("\n"),
    mfaAmr: provider.mfaAmr.join(" "),
    mfaAcr: provider.mfaAcr.join("\n"),
  };
}

function fromDraft(draft: ProviderDraft) {
  return {
    id: draft.id.trim(),
    name: draft.name.trim(),
    enabled: draft.enabled,
    issuer: draft.issuer.trim(),
    clientId: draft.clientId.trim(),
    ...(draft.clientSecret.trim() ? { clientSecret: draft.clientSecret.trim() } : {}),
    scopes: words(draft.scopes),
    allowedDomains: words(draft.allowedDomains).map((domain) => domain.toLowerCase()),
    mfaAmr: words(draft.mfaAmr),
    mfaAcr: draft.mfaAcr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
  };
}

const EMPTY: ProviderDraft = {
  id: "",
  name: "",
  enabled: true,
  issuer: "https://",
  clientId: "",
  clientSecret: "",
  clientSecretSet: false,
  scopes: "openid email profile",
  allowedDomains: "",
  mfaAmr: "mfa otp hwk swk sc",
  mfaAcr: "",
};

/**
 * Sign-in policy (justflows-ce#54): roles that must use a second factor, and
 * OpenID Connect providers that can sign staff in to existing accounts.
 */
export default function SignInPolicyPage() {
  const { t } = useT();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [required, setRequired] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<ProviderDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = (data: Payload) => {
    setPayload(data);
    setRequired(data.mfa.requiredRoles);
    setDrafts(data.providers.map(toDraft));
  };

  useEffect(() => {
    void fetch("/api/security/sign-in")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || t("security.signIn.errors.loadFailed"));
        load(body as Payload);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!payload && !error) return <PageSkeleton />;
  if (!payload) return <LoadError error={error ?? t("security.shared.unknownError")} />;

  const providers = drafts.map(fromDraft);
  const dirty =
    JSON.stringify([...required].sort()) !== JSON.stringify([...payload.mfa.requiredRoles].sort()) ||
    JSON.stringify(providers) !== JSON.stringify(payload.providers.map((provider) => fromDraft(toDraft(provider))));

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/security/sign-in", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mfa: { requiredRoles: required }, providers }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t("security.signIn.errors.saveFailed"));
      load({ ...payload!, mfa: body.mfa, providers: body.providers });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const update = (index: number, patch: Partial<ProviderDraft>) =>
    setDrafts(drafts.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("security.signIn.title")}</h1>
          <p>{t("security.signIn.subtitle")}</p>
        </div>
      </header>

      <Section title={t("security.signIn.mfa.title")}>
        <p className="jf-field__hint">{t("security.signIn.mfa.hint")}</p>
        <fieldset className="jf-choice">
          <legend className="jf-field__label">{t("security.signIn.mfa.legend")}</legend>
          {payload.roles.map((role) => (
            <label className="jf-checkrow" key={role.id}>
              <input
                type="checkbox"
                checked={required.includes(role.id)}
                onChange={(e) => setRequired(e.target.checked ? [...required, role.id] : required.filter((id) => id !== role.id))}
              />
              <span>
                <strong>{role.name}</strong> <code>{role.id}</code>
              </span>
            </label>
          ))}
        </fieldset>
        {required.length > 0 ? (
          <div className="jf-banner jf-banner--warn">
            <span className="jf-banner__icon" aria-hidden="true">!</span>
            <div>
              <div className="jf-banner__title">{t("security.signIn.mfa.warnTitle")}</div>
              <div className="jf-banner__sub">{t("security.signIn.mfa.warn")}</div>
            </div>
          </div>
        ) : null}
      </Section>

      <Section title={t("security.signIn.providers.title")}>
        <p className="jf-field__hint">{t("security.signIn.providers.hint")}</p>
        {drafts.length === 0 ? <p className="jf-field__hint">{t("security.signIn.providers.none")}</p> : null}
        {drafts.map((draft, index) => (
          <fieldset className="jf-stack" key={index} style={{ borderTop: "1px solid var(--jf-border)", paddingTop: "1rem" }}>
            <legend className="jf-field__label">{draft.name || t("security.signIn.providers.newProvider")}</legend>
            <label className="jf-checkrow">
              <input type="checkbox" checked={draft.enabled} onChange={(e) => update(index, { enabled: e.target.checked })} />
              <span>{t("security.signIn.providers.enabled")}</span>
            </label>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor={`oidc-name-${index}`}>{t("security.signIn.providers.name")}</label>
              <input id={`oidc-name-${index}`} className="jf-input" maxLength={60} value={draft.name} onChange={(e) => update(index, { name: e.target.value })} />
              <p className="jf-field__hint">{t("security.signIn.providers.nameHint")}</p>
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor={`oidc-id-${index}`}>{t("security.signIn.providers.id")}</label>
              <input
                id={`oidc-id-${index}`}
                className="jf-input jf-input--mono"
                maxLength={63}
                value={draft.id}
                spellCheck={false}
                onChange={(e) => update(index, { id: e.target.value.toLowerCase() })}
              />
              <p className="jf-field__hint">
                {t("security.signIn.providers.callback")} <code>{`${payload.callbackBase}${draft.id || "…"}/callback`}</code>
              </p>
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor={`oidc-issuer-${index}`}>{t("security.signIn.providers.issuer")}</label>
              <input id={`oidc-issuer-${index}`} className="jf-input jf-input--mono" value={draft.issuer} spellCheck={false} onChange={(e) => update(index, { issuer: e.target.value })} />
              <p className="jf-field__hint">{t("security.signIn.providers.issuerHint")}</p>
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor={`oidc-client-${index}`}>{t("security.signIn.providers.clientId")}</label>
              <input id={`oidc-client-${index}`} className="jf-input jf-input--mono" value={draft.clientId} spellCheck={false} autoComplete="off" onChange={(e) => update(index, { clientId: e.target.value })} />
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor={`oidc-secret-${index}`}>{t("security.signIn.providers.clientSecret")}</label>
              <input
                id={`oidc-secret-${index}`}
                className="jf-input jf-input--mono"
                type="password"
                autoComplete="new-password"
                value={draft.clientSecret}
                placeholder={draft.clientSecretSet ? t("security.signIn.providers.secretStored") : ""}
                onChange={(e) => update(index, { clientSecret: e.target.value })}
              />
              <p className="jf-field__hint">{t("security.signIn.providers.clientSecretHint")}</p>
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor={`oidc-scopes-${index}`}>{t("security.signIn.providers.scopes")}</label>
              <input id={`oidc-scopes-${index}`} className="jf-input jf-input--mono" value={draft.scopes} spellCheck={false} onChange={(e) => update(index, { scopes: e.target.value })} />
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor={`oidc-domains-${index}`}>{t("security.signIn.providers.allowedDomains")}</label>
              <textarea
                id={`oidc-domains-${index}`}
                className="jf-input jf-input--mono"
                rows={2}
                spellCheck={false}
                value={draft.allowedDomains}
                placeholder="example.com"
                onChange={(e) => update(index, { allowedDomains: e.target.value })}
              />
              <p className="jf-field__hint">{t("security.signIn.providers.allowedDomainsHint")}</p>
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor={`oidc-amr-${index}`}>{t("security.signIn.providers.mfaAmr")}</label>
              <input id={`oidc-amr-${index}`} className="jf-input jf-input--mono" value={draft.mfaAmr} spellCheck={false} onChange={(e) => update(index, { mfaAmr: e.target.value })} />
            </div>
            <div className="jf-field">
              <label className="jf-field__label" htmlFor={`oidc-acr-${index}`}>{t("security.signIn.providers.mfaAcr")}</label>
              <textarea
                id={`oidc-acr-${index}`}
                className="jf-input jf-input--mono"
                rows={2}
                spellCheck={false}
                value={draft.mfaAcr}
                onChange={(e) => update(index, { mfaAcr: e.target.value })}
              />
              <p className="jf-field__hint">{t("security.signIn.providers.mfaHint")}</p>
            </div>
            <div className="jf-row">
              <button className="jf-btn jf-btn--ghost" type="button" onClick={() => setDrafts(drafts.filter((_, i) => i !== index))}>
                {t("security.signIn.providers.remove")}
              </button>
            </div>
          </fieldset>
        ))}
        {drafts.length < MAX_PROVIDERS ? (
          <div className="jf-row">
            <button className="jf-btn" type="button" onClick={() => setDrafts([...drafts, { ...EMPTY }])}>
              {t("security.signIn.providers.add")}
            </button>
          </div>
        ) : null}
      </Section>

      <SaveBar
        dirty={dirty}
        saving={saving}
        saved={saved && !dirty}
        error={error}
        onSave={() => void save()}
        onDiscard={() => {
          load(payload);
          setError(null);
        }}
      />
    </div>
  );
}
