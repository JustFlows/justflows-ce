import { useState } from "react";
import { useSecurityConfig } from "./useSecurityConfig";
import {
  GradeBadge,
  HeaderPreview,
  KillSwitchNotice,
  LoadError,
  PageSkeleton,
  SaveBar,
  ScopeSelect,
  Section,
} from "./components";
import { SCOPE_LABELS, type CustomHeader, type HeaderScope, type SecurityHeadersConfig } from "./types";
import { useT } from "../../../i18n/I18nProvider";

/**
 * Headers that frame the response body. The server refuses them too — listing
 * them here means the admin finds out before they hit Save.
 */
const PROTECTED_NAMES = new Set([
  "content-length",
  "content-type",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "trailer",
  "te",
  "host",
  "date",
  "location",
  "set-cookie",
]);

export default function SecurityAdvancedPage() {
  const { t } = useT();
  const state = useSecurityConfig();
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  if (state.loading) return <PageSkeleton />;
  if (!state.payload || !state.draft) {
    return <LoadError error={state.error ?? t("security.shared.unknownError")} />;
  }

  const { draft, payload } = state;

  const setCustom = (next: CustomHeader[]) =>
    state.setDraft((config) => {
      config.custom = next;
      return config;
    });

  const knownHeaderNames = new Set(payload.catalog.map((d) => d.header.toLowerCase()));

  function problemWith(header: CustomHeader, index: number): string | null {
    const name = header.name.trim();
    if (!name) return t("security.advanced.validation.needName");
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) return t("security.advanced.validation.invalidName");
    if (PROTECTED_NAMES.has(name.toLowerCase())) {
      return t("security.advanced.validation.protected");
    }
    if (knownHeaderNames.has(name.toLowerCase())) {
      return t("security.advanced.validation.hasOwnPage");
    }
    if (draft.custom.some((h, i) => i !== index && h.name.trim().toLowerCase() === name.toLowerCase())) {
      return t("security.advanced.validation.duplicate");
    }
    if (/[\r\n]/.test(header.value)) return t("security.advanced.validation.lineBreaks");
    return null;
  }

  function applyImport() {
    setImportError(null);
    try {
      const parsed = JSON.parse(importText) as SecurityHeadersConfig;
      if (!parsed || typeof parsed !== "object" || !parsed.headers) {
        setImportError(t("security.advanced.import.notConfig"));
        return;
      }
      state.replaceDraft(parsed);
      setImportText("");
    } catch (e) {
      setImportError(
        t("security.advanced.import.readError", {
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  }

  const exportJson = JSON.stringify(draft, null, 2);

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("security.advanced.title")}</h1>
          <p>{t("security.advanced.subtitle")}</p>
        </div>
        <div className="jf-pagehead__actions">
          {state.audit && <GradeBadge audit={state.audit} live={state.dirty} />}
        </div>
      </header>

      {payload.killSwitch && <KillSwitchNotice />}

      <Section
        title={t("security.advanced.customHeaders.title")}
        action={
          <button
            className="jf-btn jf-btn--ghost"
            onClick={() =>
              setCustom([...draft.custom, { name: "", value: "", enabled: true, scope: "all" }])
            }
            disabled={draft.custom.length >= 50}
          >
            {t("security.advanced.customHeaders.add")}
          </button>
        }
      >
        <p className="jf-field__hint">
          {t("security.advanced.customHeaders.hint")}
        </p>

        {draft.custom.length === 0 ? (
          <div className="jf-empty">
            <div className="jf-empty__icon" aria-hidden="true">
              ⌗
            </div>
            <div className="jf-empty__title">{t("security.advanced.customHeaders.emptyTitle")}</div>
          </div>
        ) : (
          <div className="jf-stack jf-stack--sm">
            {draft.custom.map((header, index) => {
              const problem = problemWith(header, index);
              return (
                <div key={index} className="jf-card">
                  <div className="jf-card__body jf-stack jf-stack--sm">
                    <div className="jf-itemrow">
                      <div className="jf-field" style={{ flex: "0 0 18rem" }}>
                        <label className="jf-field__label" htmlFor={`custom-name-${index}`}>
                          {t("security.advanced.customHeaders.nameLabel")}
                        </label>
                        <input
                          id={`custom-name-${index}`}
                          className={`jf-input jf-input--mono${problem ? " jf-input--invalid" : ""}`}
                          value={header.name}
                          placeholder="Reporting-Endpoints"
                          onChange={(e) => {
                            const next = [...draft.custom];
                            next[index] = { ...header, name: e.target.value };
                            setCustom(next);
                          }}
                        />
                      </div>
                      <div className="jf-field" style={{ flex: 1 }}>
                        <label className="jf-field__label" htmlFor={`custom-value-${index}`}>
                          {t("security.advanced.customHeaders.valueLabel")}
                        </label>
                        <input
                          id={`custom-value-${index}`}
                          className="jf-input jf-input--mono"
                          value={header.value}
                          placeholder='default="https://example.com/reports"'
                          onChange={(e) => {
                            const next = [...draft.custom];
                            next[index] = { ...header, value: e.target.value };
                            setCustom(next);
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        className="jf-iconbtn jf-iconbtn--danger"
                        aria-label={t("security.advanced.customHeaders.removeAria", {
                          name: header.name || t("security.advanced.customHeaders.headerFallback"),
                        })}
                        onClick={() => setCustom(draft.custom.filter((_, i) => i !== index))}
                      >
                        ✕
                      </button>
                    </div>

                    <div className="jf-grid jf-grid--2">
                      <ScopeSelect
                        id={`custom-scope-${index}`}
                        value={header.scope}
                        onChange={(scope: HeaderScope) => {
                          const next = [...draft.custom];
                          next[index] = { ...header, scope };
                          setCustom(next);
                        }}
                      />
                      <label className="jf-checkrow jf-checkrow--stacked">
                        <input
                          type="checkbox"
                          checked={header.enabled}
                          onChange={(e) => {
                            const next = [...draft.custom];
                            next[index] = { ...header, enabled: e.target.checked };
                            setCustom(next);
                          }}
                        />
                        <span>
                          {t("security.advanced.customHeaders.send")}
                          <span className="jf-checkrow__meta">
                            {header.enabled
                              ? t("security.advanced.customHeaders.sendActiveMeta", {
                                  scope: t(SCOPE_LABELS[header.scope]).toLowerCase(),
                                })
                              : t("security.advanced.customHeaders.sendInactiveMeta")}
                          </span>
                        </span>
                      </label>
                    </div>

                    {problem && <p className="jf-status jf-status--error">{problem}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title={t("security.advanced.serverId.title")}>
        <label className="jf-checkrow jf-checkrow--stacked">
          <input
            type="checkbox"
            checked={draft.removeServerHeader}
            onChange={(e) =>
              state.setDraft((config) => {
                config.removeServerHeader = e.target.checked;
                return config;
              })
            }
          />
          <span>
            {t("security.advanced.serverId.stripLabelPrefix")} <code>Server</code>{" "}
            {t("security.advanced.serverId.stripLabelSuffix")}
            <span className="jf-checkrow__meta">
              {t("security.advanced.serverId.metaPrefix")} <code>X-Powered-By: Justflows</code>{" "}
              {t("security.advanced.serverId.metaSuffix")}
            </span>
          </span>
        </label>
      </Section>

      <Section title={t("security.advanced.whatSent.title")}>
        <div className="jf-stack jf-stack--sm">
          <h3 className="jf-section-title">{t("security.advanced.whatSent.publicSecure")}</h3>
          {state.effective && <HeaderPreview headers={state.effective.publicSecure} />}
          <h3 className="jf-section-title">{t("security.advanced.whatSent.admin")}</h3>
          {state.effective && <HeaderPreview headers={state.effective.admin} />}
        </div>
      </Section>

      <Section title={t("security.advanced.move.title")}>
        <div className="jf-field">
          <label className="jf-field__label" htmlFor="security-export">
            {t("security.advanced.move.currentConfigLabel")}
          </label>
          <textarea
            id="security-export"
            className="jf-input jf-input--mono"
            rows={8}
            readOnly
            value={exportJson}
            onFocus={(e) => e.currentTarget.select()}
          />
          <p className="jf-field__hint">
            {t("security.advanced.move.currentConfigHint")}
          </p>
        </div>

        <div className="jf-field">
          <label className="jf-field__label" htmlFor="security-import">
            {t("security.advanced.move.pasteLabel")}
          </label>
          <textarea
            id="security-import"
            className="jf-input jf-input--mono"
            rows={6}
            value={importText}
            placeholder="{ &quot;headers&quot;: { … } }"
            onChange={(e) => setImportText(e.target.value)}
          />
          {importError && <p className="jf-status jf-status--error">{importError}</p>}
          <div className="jf-row">
            <button
              className="jf-btn jf-btn--ghost"
              onClick={applyImport}
              disabled={!importText.trim()}
            >
              {t("security.advanced.move.loadButton")}
            </button>
            <span className="jf-field__hint">
              {t("security.advanced.move.loadHint")}
            </span>
          </div>
        </div>
      </Section>

      <Section title={t("security.advanced.reset.title")}>
        <p className="jf-field__hint">
          {t("security.advanced.reset.hint")}
        </p>
        <div className="jf-row">
          {confirmingReset ? (
            <>
              <button
                className="jf-btn jf-btn--danger"
                onClick={() => {
                  setConfirmingReset(false);
                  void state.resetToDefaults();
                }}
                disabled={state.saving}
              >
                {t("security.advanced.reset.confirm")}
              </button>
              <button className="jf-btn jf-btn--ghost" onClick={() => setConfirmingReset(false)}>
                {t("common.cancel")}
              </button>
            </>
          ) : (
            <button className="jf-btn jf-btn--danger" onClick={() => setConfirmingReset(true)}>
              {t("security.advanced.reset.button")}
            </button>
          )}
        </div>
      </Section>

      <Section title={t("security.advanced.lockout.title")}>
        <p className="jf-field__hint">
          {t("security.advanced.lockout.bodyPrefix")} <code>JF_SECURITY_HEADERS_DISABLED=1</code>{" "}
          {t("security.advanced.lockout.bodySuffix")}
        </p>
      </Section>

      <SaveBar
        dirty={state.dirty}
        saving={state.saving}
        saved={state.saved}
        error={state.error}
        onSave={() => void state.save()}
        onDiscard={state.discard}
      />
    </div>
  );
}
