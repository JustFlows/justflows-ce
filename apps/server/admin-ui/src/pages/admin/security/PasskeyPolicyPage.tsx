// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import { LoadError, PageSkeleton, SaveBar, Section } from "./components";
import { useT } from "../../../i18n/I18nProvider";

type Mode = "allow" | "require" | "disallow";

type Policy = {
  defaultMode: Mode;
  roles: Record<string, Mode>;
  userVerification: "required" | "preferred";
  attestation: "none" | "direct";
  allowedAaguids: string[];
  rpId: string | null;
  extraOrigins: string[];
};

type Payload = {
  policy: Policy;
  roles: Array<{ id: string; name: string; builtIn: boolean }>;
  relyingParty: { rpId: string; origins: string[]; hostname: string };
};

const MODES: Mode[] = ["allow", "require", "disallow"];

const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

/**
 * Operator policy for passkeys (#105): who may or must use them, how strictly
 * the authenticator verifies the user, attestation, and the relying party.
 */
export default function PasskeyPolicyPage() {
  const { t } = useT();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [aaguids, setAaguids] = useState("");
  const [origins, setOrigins] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = (data: Payload) => {
    setPayload(data);
    setDraft(data.policy);
    setAaguids(data.policy.allowedAaguids.join("\n"));
    setOrigins(data.policy.extraOrigins.join("\n"));
  };

  useEffect(() => {
    void fetch("/api/security/passkeys")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || t("security.passkeys.errors.loadFailed"));
        load(body as Payload);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!payload && !error) return <PageSkeleton />;
  if (!payload || !draft) return <LoadError error={error ?? t("security.shared.unknownError")} />;

  const candidate: Policy = { ...draft, allowedAaguids: lines(aaguids).map((v) => v.toLowerCase()), extraOrigins: lines(origins) };
  const dirty = JSON.stringify(candidate) !== JSON.stringify(payload.policy);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/security/passkeys", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policy: candidate }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t("security.passkeys.errors.saveFailed"));
      load({ ...payload!, policy: body.policy, relyingParty: body.relyingParty });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const modeLabel = (mode: Mode) => t(`security.passkeys.modes.${mode}`);
  const setRole = (role: string, value: string) => {
    const roles = { ...draft.roles };
    if (value === "") delete roles[role];
    else roles[role] = value as Mode;
    setDraft({ ...draft, roles });
  };
  const requiredRoles = payload.roles.filter((role) => (draft.roles[role.id] ?? draft.defaultMode) === "require");

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("security.passkeys.title")}</h1>
          <p>{t("security.passkeys.subtitle")}</p>
        </div>
      </header>

      <Section title={t("security.passkeys.roles.title")}>
        <p className="jf-field__hint">{t("security.passkeys.roles.hint")}</p>
        <div className="jf-field">
          <label className="jf-field__label" htmlFor="passkey-default-mode">{t("security.passkeys.roles.default")}</label>
          <select
            id="passkey-default-mode"
            className="jf-input"
            style={{ maxWidth: "20rem" }}
            value={draft.defaultMode}
            onChange={(e) => setDraft({ ...draft, defaultMode: e.target.value as Mode })}
          >
            {MODES.map((mode) => <option key={mode} value={mode}>{modeLabel(mode)}</option>)}
          </select>
        </div>
        <div className="jf-stack">
          {payload.roles.map((role) => (
            <div className="jf-row" key={role.id}>
              <label style={{ flex: 1 }} htmlFor={`passkey-role-${role.id}`}>
                <strong>{role.name}</strong> <code>{role.id}</code>
              </label>
              <select
                id={`passkey-role-${role.id}`}
                className="jf-input"
                style={{ maxWidth: "20rem" }}
                value={draft.roles[role.id] ?? ""}
                onChange={(e) => setRole(role.id, e.target.value)}
              >
                <option value="">{t("security.passkeys.roles.useDefault", { mode: modeLabel(draft.defaultMode) })}</option>
                {MODES.map((mode) => <option key={mode} value={mode}>{modeLabel(mode)}</option>)}
              </select>
            </div>
          ))}
        </div>
        <ul className="jf-field__hint">
          <li>{t("security.passkeys.roles.allowExplain")}</li>
          <li>{t("security.passkeys.roles.requireExplain")}</li>
          <li>{t("security.passkeys.roles.disallowExplain")}</li>
        </ul>
        {requiredRoles.length > 0 ? (
          <div className="jf-banner jf-banner--warn">
            <span className="jf-banner__icon" aria-hidden="true">!</span>
            <div>
              <div className="jf-banner__title">{t("security.passkeys.roles.requireWarnTitle")}</div>
              <div className="jf-banner__sub">{t("security.passkeys.roles.requireWarn")}</div>
            </div>
          </div>
        ) : null}
      </Section>

      <Section title={t("security.passkeys.verification.title")}>
        <fieldset className="jf-choice">
          <legend className="jf-field__label">{t("security.passkeys.verification.legend")}</legend>
          {(["preferred", "required"] as const).map((value) => (
            <label className="jf-checkrow" key={value}>
              <input
                name="passkey-uv"
                type="radio"
                checked={draft.userVerification === value}
                onChange={() => setDraft({ ...draft, userVerification: value })}
              />
              <span>
                {t(`security.passkeys.verification.${value}`)}
                <span className="jf-checkrow__meta">{t(`security.passkeys.verification.${value}Meta`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Section>

      <Section title={t("security.passkeys.attestation.title")}>
        <fieldset className="jf-choice">
          <legend className="jf-field__label">{t("security.passkeys.attestation.legend")}</legend>
          {(["none", "direct"] as const).map((value) => (
            <label className="jf-checkrow" key={value}>
              <input
                name="passkey-attestation"
                type="radio"
                checked={draft.attestation === value}
                onChange={() => setDraft({ ...draft, attestation: value })}
              />
              <span>
                {t(`security.passkeys.attestation.${value}`)}
                {value === "none" ? <> <span className="jf-chip">{t("security.shared.recommended")}</span></> : null}
                <span className="jf-checkrow__meta">{t(`security.passkeys.attestation.${value}Meta`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {draft.attestation === "direct" ? (
          <div className="jf-field">
            <label className="jf-field__label" htmlFor="passkey-aaguids">{t("security.passkeys.attestation.aaguidsLabel")}</label>
            <textarea
              id="passkey-aaguids"
              className="jf-input jf-input--mono"
              rows={4}
              spellCheck={false}
              value={aaguids}
              placeholder="cb69481e-8ff7-4039-93ec-0a2729a154a8"
              onChange={(e) => setAaguids(e.target.value)}
            />
            <p className="jf-field__hint">{t("security.passkeys.attestation.aaguidsHint")}</p>
          </div>
        ) : null}
      </Section>

      <Section title={t("security.passkeys.relyingParty.title")}>
        <p className="jf-field__hint">
          {t("security.passkeys.relyingParty.current")} <code>{payload.relyingParty.rpId}</code>
        </p>
        <p className="jf-field__hint">
          {t("security.passkeys.relyingParty.origins")} {payload.relyingParty.origins.map((origin) => <code key={origin}>{origin} </code>)}
        </p>
        <div className="jf-field">
          <label className="jf-field__label" htmlFor="passkey-rp-id">{t("security.passkeys.relyingParty.rpIdLabel")}</label>
          <input
            id="passkey-rp-id"
            className="jf-input jf-input--mono"
            style={{ maxWidth: "32rem" }}
            value={draft.rpId ?? ""}
            placeholder={payload.relyingParty.hostname}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setDraft({ ...draft, rpId: e.target.value.trim() ? e.target.value.trim().toLowerCase() : null })}
          />
          <p className="jf-field__hint">{t("security.passkeys.relyingParty.rpIdHint")}</p>
        </div>
        <div className="jf-field">
          <label className="jf-field__label" htmlFor="passkey-origins">{t("security.passkeys.relyingParty.extraOriginsLabel")}</label>
          <textarea
            id="passkey-origins"
            className="jf-input jf-input--mono"
            rows={3}
            spellCheck={false}
            value={origins}
            placeholder="https://www.example.com"
            onChange={(e) => setOrigins(e.target.value)}
          />
          <p className="jf-field__hint">{t("security.passkeys.relyingParty.extraOriginsHint")}</p>
        </div>
        <div className="jf-banner jf-banner--warn">
          <span className="jf-banner__icon" aria-hidden="true">!</span>
          <div>
            <div className="jf-banner__title">{t("security.passkeys.relyingParty.warnTitle")}</div>
            <div className="jf-banner__sub">{t("security.passkeys.relyingParty.warn")}</div>
          </div>
        </div>
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
