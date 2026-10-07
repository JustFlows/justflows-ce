// SPDX-License-Identifier: MIT

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "../../../admin-router";
import { useT } from "../../../i18n/I18nProvider";

interface Settings {
  enabled: boolean;
  provider: "manual" | "bunny";
  modes: { records: boolean; nameservers: boolean };
  cnameTarget: string;
  apexAddresses: string[];
  nameservers: string[];
  soaEmail: string;
  includeWww: boolean;
  redirectToPrimary: boolean;
  pendingExpiryDays: number;
  failureThreshold: number;
  upgradeUrl: string;
  bunny: { pullZoneId: string; apiKey: { last4: string } | null };
}

interface Overview {
  settings: Settings;
  providerNameservers: string[];
  nameserverAddresses: Array<{ ipv4: string; ipv6: string }>;
}

async function platformJson<T>(
  path: string,
  init: RequestInit | undefined,
  fallback: string,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? fallback);
  return body as T;
}

function lines(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Platform → Custom domains. How websites connect their own domains, which
 * provider serves them, and where a website without access is sent to
 * upgrade. What each website may use is set with the domain limits on
 * Platform → Defaults and on each website.
 */
export default function PlatformDomainsPage() {
  const { t } = useT();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [apexText, setApexText] = useState("");
  const [nsText, setNsText] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "test">("");

  function accept(next: Overview) {
    setOverview(next);
    setDraft(next.settings);
    setApexText(next.settings.apexAddresses.join("\n"));
    setNsText(next.settings.nameservers.join("\n"));
    setApiKey("");
  }

  useEffect(() => {
    platformJson<Overview>("/api/platform/custom-domains", undefined, t("platform.forbidden"))
      .then(accept)
      .catch((err: Error) => setError(err.message));
  }, [t]);

  function patch(next: Partial<Settings>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy("save");
    setError("");
    setNotice("");
    try {
      const next = await platformJson<Overview>(
        "/api/platform/custom-domains",
        {
          method: "PUT",
          body: JSON.stringify({
            enabled: draft.enabled,
            provider: draft.provider,
            modes: draft.modes,
            cnameTarget: draft.cnameTarget,
            apexAddresses: lines(apexText),
            nameservers: lines(nsText),
            soaEmail: draft.soaEmail,
            includeWww: draft.includeWww,
            redirectToPrimary: draft.redirectToPrimary,
            pendingExpiryDays: Number(draft.pendingExpiryDays),
            failureThreshold: Number(draft.failureThreshold),
            upgradeUrl: draft.upgradeUrl,
            bunny: { pullZoneId: draft.bunny.pullZoneId, apiKey: apiKey.trim() || undefined },
          }),
        },
        t("platformDomains.failed"),
      );
      accept(next);
      setNotice(t("platform.saved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("platformDomains.failed"));
    } finally {
      setBusy("");
    }
  }

  async function test() {
    setBusy("test");
    setError("");
    setNotice("");
    try {
      const result = await platformJson<{ cnameTarget: string | null }>(
        "/api/platform/custom-domains/test",
        { method: "POST" },
        t("platformDomains.failed"),
      );
      if (result.cnameTarget && draft && !draft.cnameTarget)
        patch({ cnameTarget: result.cnameTarget });
      setNotice(
        result.cnameTarget
          ? t("platformDomains.testOkTarget", { target: result.cnameTarget })
          : t("platformDomains.testOk"),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("platformDomains.failed"));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("platformDomains.title")}</h1>
          <p>{t("platformDomains.intro")}</p>
        </div>
      </header>
      {error && (
        <div className="jf-alert jf-alert--error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="jf-alert jf-alert--success" role="status">
          {notice}
        </div>
      )}

      {!draft || !overview ? (
        !error && <p>{t("common.loading")}</p>
      ) : (
        <form className="jf-stack jf-stack--lg" onSubmit={(event) => void save(event)}>
          <section className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">{t("platformDomains.offerTitle")}</h2>
            </div>
            <div className="jf-card__body jf-stack">
              <label className="jf-checkrow">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => patch({ enabled: event.target.checked })}
                />
                <span>{t("platformDomains.enabled")}</span>
              </label>
              <p className="jf-field__hint">{t("platformDomains.enabledHint")}</p>
              <fieldset className="jf-choice">
                <legend className="jf-field__label">{t("platformDomains.modes")}</legend>
                <label className="jf-checkrow">
                  <input
                    type="checkbox"
                    checked={draft.modes.records}
                    onChange={(event) =>
                      patch({ modes: { ...draft.modes, records: event.target.checked } })
                    }
                  />
                  <span>{t("platformDomains.modeRecords")}</span>
                </label>
                <label className="jf-checkrow">
                  <input
                    type="checkbox"
                    checked={draft.modes.nameservers}
                    disabled={draft.provider !== "bunny"}
                    onChange={(event) =>
                      patch({ modes: { ...draft.modes, nameservers: event.target.checked } })
                    }
                  />
                  <span>{t("platformDomains.modeNameservers")}</span>
                </label>
                <p className="jf-field__hint">{t("platformDomains.modesHint")}</p>
              </fieldset>
              <p className="jf-field__hint">
                {t("platformDomains.limitsHint")}{" "}
                <Link to="/admin/platform/defaults">{t("nav.defaults")}</Link>
              </p>
              <div className="jf-grid jf-grid--2">
                <Field
                  label={t("platformDomains.upgradeUrl")}
                  hint={t("platformDomains.upgradeUrlHint")}
                >
                  <input
                    className="jf-input"
                    type="url"
                    value={draft.upgradeUrl}
                    maxLength={500}
                    placeholder="https://"
                    onChange={(event) => patch({ upgradeUrl: event.target.value })}
                  />
                </Field>
              </div>
            </div>
          </section>

          <section className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">{t("platformDomains.providerTitle")}</h2>
            </div>
            <div className="jf-card__body jf-stack">
              <fieldset className="jf-choice">
                <legend className="jf-field__label">{t("platformDomains.provider")}</legend>
                <label className="jf-checkrow">
                  <input
                    type="radio"
                    name="provider"
                    checked={draft.provider === "bunny"}
                    onChange={() => patch({ provider: "bunny" })}
                  />
                  <span>Bunny.net</span>
                </label>
                <p className="jf-field__hint">{t("platformDomains.providerBunnyHint")}</p>
                <label className="jf-checkrow">
                  <input
                    type="radio"
                    name="provider"
                    checked={draft.provider === "manual"}
                    onChange={() =>
                      patch({ provider: "manual", modes: { ...draft.modes, nameservers: false } })
                    }
                  />
                  <span>{t("platformDomains.providerManual")}</span>
                </label>
                <p className="jf-field__hint">{t("platformDomains.providerManualHint")}</p>
              </fieldset>

              {draft.provider === "bunny" && (
                <div className="jf-grid jf-grid--2">
                  <Field
                    label={t("platformDomains.pullZoneId")}
                    hint={t("platformDomains.pullZoneIdHint")}
                  >
                    <input
                      className="jf-input jf-input--mono"
                      inputMode="numeric"
                      value={draft.bunny.pullZoneId}
                      maxLength={20}
                      onChange={(event) =>
                        patch({ bunny: { ...draft.bunny, pullZoneId: event.target.value } })
                      }
                    />
                  </Field>
                  <Field label={t("platformDomains.apiKey")} hint={t("platformDomains.apiKeyHint")}>
                    <input
                      className="jf-input"
                      type="password"
                      autoComplete="off"
                      maxLength={200}
                      value={apiKey}
                      placeholder={
                        draft.bunny.apiKey
                          ? t("cdn.secretSaved", { last4: draft.bunny.apiKey.last4 })
                          : undefined
                      }
                      onChange={(event) => setApiKey(event.target.value)}
                    />
                  </Field>
                </div>
              )}

              <div className="jf-grid jf-grid--2">
                <Field
                  label={t("platformDomains.cnameTarget")}
                  hint={t("platformDomains.cnameTargetHint")}
                >
                  <input
                    className="jf-input jf-input--mono"
                    value={draft.cnameTarget}
                    maxLength={253}
                    placeholder="example.b-cdn.net"
                    onChange={(event) => patch({ cnameTarget: event.target.value })}
                  />
                </Field>
                <Field
                  label={t("platformDomains.apexAddresses")}
                  hint={t("platformDomains.apexAddressesHint")}
                >
                  <textarea
                    className="jf-input jf-input--mono"
                    rows={2}
                    value={apexText}
                    onChange={(event) => setApexText(event.target.value)}
                  />
                </Field>
              </div>
              {draft.provider === "manual" && (
                <p className="jf-field__hint">{t("platformDomains.tlsAskHint")}</p>
              )}
            </div>
          </section>

          {draft.provider === "bunny" && (
            <section className="jf-card">
              <div className="jf-card__head">
                <h2 className="jf-card__title">{t("platformDomains.dnsTitle")}</h2>
              </div>
              <div className="jf-card__body jf-stack">
                <p className="jf-field__hint">
                  {t("platformDomains.dnsIntro", {
                    nameservers: overview.providerNameservers.join(", "),
                  })}
                </p>
                <div className="jf-grid jf-grid--2">
                  <Field
                    label={t("platformDomains.nameservers")}
                    hint={t("platformDomains.nameserversHint")}
                  >
                    <textarea
                      className="jf-input jf-input--mono"
                      rows={2}
                      value={nsText}
                      placeholder={"ns1.example.com\nns2.example.com"}
                      onChange={(event) => setNsText(event.target.value)}
                    />
                  </Field>
                  <Field
                    label={t("platformDomains.soaEmail")}
                    hint={t("platformDomains.soaEmailHint")}
                  >
                    <input
                      className="jf-input"
                      type="email"
                      value={draft.soaEmail}
                      maxLength={254}
                      onChange={(event) => patch({ soaEmail: event.target.value })}
                    />
                  </Field>
                </div>
                <p className="jf-field__hint">{t("platformDomains.glueHint")}</p>
                <ul className="jf-field__hint">
                  {overview.nameserverAddresses.map((entry, index) => (
                    <li key={entry.ipv4} className="jf-input--mono">
                      {lines(nsText)[index] ?? `ns${index + 1}`} → {entry.ipv4} / {entry.ipv6}
                    </li>
                  ))}
                </ul>
                <label className="jf-checkrow">
                  <input
                    type="checkbox"
                    checked={draft.includeWww}
                    onChange={(event) => patch({ includeWww: event.target.checked })}
                  />
                  <span>{t("platformDomains.includeWww")}</span>
                </label>
              </div>
            </section>
          )}

          <section className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">{t("platformDomains.behaviourTitle")}</h2>
            </div>
            <div className="jf-card__body jf-stack">
              <label className="jf-checkrow">
                <input
                  type="checkbox"
                  checked={draft.redirectToPrimary}
                  onChange={(event) => patch({ redirectToPrimary: event.target.checked })}
                />
                <span>{t("platformDomains.redirectToPrimary")}</span>
              </label>
              <p className="jf-field__hint">{t("platformDomains.redirectToPrimaryHint")}</p>
              <div className="jf-grid jf-grid--2">
                <Field
                  label={t("platformDomains.pendingExpiryDays")}
                  hint={t("platformDomains.pendingExpiryDaysHint")}
                >
                  <input
                    className="jf-input"
                    type="number"
                    min={1}
                    max={90}
                    required
                    value={draft.pendingExpiryDays}
                    onChange={(event) => patch({ pendingExpiryDays: Number(event.target.value) })}
                  />
                </Field>
                <Field
                  label={t("platformDomains.failureThreshold")}
                  hint={t("platformDomains.failureThresholdHint")}
                >
                  <input
                    className="jf-input"
                    type="number"
                    min={1}
                    max={50}
                    required
                    value={draft.failureThreshold}
                    onChange={(event) => patch({ failureThreshold: Number(event.target.value) })}
                  />
                </Field>
              </div>
            </div>
          </section>

          <div className="jf-row">
            <button className="jf-btn jf-btn--primary" type="submit" disabled={busy !== ""}>
              {busy === "save" ? t("common.saving") : t("common.save")}
            </button>
            {overview.settings.provider === "bunny" && (
              <button
                className="jf-btn"
                type="button"
                disabled={busy !== ""}
                onClick={() => void test()}
              >
                {busy === "test" ? t("cdn.testing") : t("cdn.test")}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="jf-field">
      <span className="jf-field__label">{label}</span>
      {children}
      {hint && <span className="jf-field__hint">{hint}</span>}
    </label>
  );
}
