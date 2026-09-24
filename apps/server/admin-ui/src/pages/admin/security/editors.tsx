import { useMemo } from "react";
import {
  CSP_DIRECTIVES,
  CSP_SOURCE_KEYWORDS,
  CSP_VALUELESS_DIRECTIVES,
  HSTS_PRESETS,
  PERMISSIONS_FEATURES,
  allowlistForChoice,
  parseCsp,
  parseHsts,
  parsePermissionsPolicy,
  permissionChoiceOf,
  serializeCsp,
  serializeHsts,
  serializePermissionsPolicy,
  type PermissionChoice,
} from "./policy";
import type { HeaderEntry, SecurityHeaderDef } from "./types";
import { useT } from "../../../i18n/I18nProvider";

export type EditorProps = {
  def: SecurityHeaderDef;
  entry: HeaderEntry;
  onChange: (patch: Partial<HeaderEntry>) => void;
};

/** A fixed vocabulary: show every value with what it actually does. */
export function ChoiceEditor({ def, entry, onChange }: EditorProps) {
  const { t } = useT();
  return (
    <div className="jf-stack jf-stack--sm">
      {def.options?.map((option) => (
        <label key={option.value} className="jf-checkrow">
          <input
            type="radio"
            name={`${def.id}-value`}
            checked={entry.value.trim().toLowerCase() === option.value.toLowerCase()}
            onChange={() => onChange({ value: option.value })}
          />
          <span>
            <code>{option.label}</code>
            {option.recommended && <span className="jf-chip">{t("security.shared.recommended")}</span>}
            <span className="jf-checkrow__meta">{option.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function HstsEditor({ def, entry, onChange }: EditorProps) {
  const { t } = useT();
  const parts = useMemo(() => parseHsts(entry.value), [entry.value]);
  const update = (next: Partial<typeof parts>) =>
    onChange({ value: serializeHsts({ ...parts, ...next }) });

  return (
    <div className="jf-stack jf-stack--sm">
      <div className="jf-grid jf-grid--2">
        <div className="jf-field">
          <label className="jf-field__label" htmlFor={`${def.id}-preset`}>
            {t("security.headers.hsts.presetLabel")}
          </label>
          <select
            id={`${def.id}-preset`}
            className="jf-input"
            value={HSTS_PRESETS.some((p) => p.seconds === parts.maxAge) ? String(parts.maxAge) : "custom"}
            onChange={(e) => {
              if (e.target.value === "custom") return;
              update({ maxAge: Number(e.target.value) });
            }}
          >
            {HSTS_PRESETS.map((preset) => (
              <option key={preset.seconds} value={preset.seconds}>
                {t(preset.label)}
              </option>
            ))}
            <option value="custom">{t("security.headers.hsts.customOption")}</option>
          </select>
        </div>
        <div className="jf-field">
          <label className="jf-field__label" htmlFor={`${def.id}-maxage`}>
            {t("security.headers.hsts.maxAgeLabel")}
          </label>
          <input
            id={`${def.id}-maxage`}
            className="jf-input"
            type="number"
            min={0}
            value={parts.maxAge}
            onChange={(e) => update({ maxAge: Number(e.target.value) })}
          />
        </div>
      </div>

      <label className="jf-checkrow jf-checkrow--stacked">
        <input
          type="checkbox"
          checked={parts.includeSubDomains}
          onChange={(e) => update({ includeSubDomains: e.target.checked })}
        />
        <span>
          {t("security.headers.hsts.includeSubdomains")}
          <span className="jf-checkrow__meta">
            {t("security.headers.hsts.includeSubdomainsMeta")}
          </span>
        </span>
      </label>

      <label className="jf-checkrow jf-checkrow--stacked">
        <input
          type="checkbox"
          checked={parts.preload}
          onChange={(e) => update({ preload: e.target.checked })}
        />
        <span>
          {t("security.headers.hsts.preload")}
          <span className="jf-checkrow__meta">
            {t("security.headers.hsts.preloadMeta")}
          </span>
        </span>
      </label>

      <label className="jf-checkrow jf-checkrow--stacked">
        <input
          type="checkbox"
          checked={entry.onlyWhenSecure !== false}
          onChange={(e) => onChange({ onlyWhenSecure: e.target.checked })}
        />
        <span>
          {t("security.headers.hsts.onlyHttps")}
          <span className="jf-checkrow__meta">
            {t("security.headers.hsts.onlyHttpsMeta")}
          </span>
        </span>
      </label>

      {parts.preload && !parts.includeSubDomains && (
        <p className="jf-status jf-status--error">
          {t("security.headers.hsts.preloadRequiresSubdomains")}
        </p>
      )}
    </div>
  );
}

export function CspEditor({ def, entry, onChange }: EditorProps) {
  const { t } = useT();
  const directives = useMemo(() => parseCsp(entry.value), [entry.value]);
  const used = new Set(directives.map((d) => d.name));

  const write = (next: typeof directives) => onChange({ value: serializeCsp(next) });

  return (
    <div className="jf-stack jf-stack--sm">
      <div className="jf-field">
        <label className="jf-field__label" htmlFor={`${def.id}-mode`}>
          {t("security.headers.csp.modeLabel")}
        </label>
        <select
          id={`${def.id}-mode`}
          className="jf-input"
          value={entry.mode ?? "enforce"}
          onChange={(e) => onChange({ mode: e.target.value as "enforce" | "report-only" })}
        >
          <option value="report-only">{t("security.headers.csp.modeReportOnly")}</option>
          <option value="enforce">{t("security.headers.csp.modeEnforce")}</option>
        </select>
        <p className="jf-field__hint">
          {entry.mode === "report-only"
            ? t("security.headers.csp.hintReportOnly")
            : t("security.headers.csp.hintEnforce")}
        </p>
      </div>

      <div className="jf-stack jf-stack--sm">
        {directives.map((directive, index) => (
          <div key={directive.name} className="jf-itemrow">
            <div className="jf-field" style={{ flex: "0 0 15rem" }}>
              <label className="jf-field__label" htmlFor={`${def.id}-d-${index}`}>
                {t("security.headers.csp.directiveLabel")}
              </label>
              <input
                id={`${def.id}-d-${index}`}
                className="jf-input jf-input--mono"
                value={directive.name}
                onChange={(e) => {
                  const next = [...directives];
                  next[index] = { ...directive, name: e.target.value.trim().toLowerCase() };
                  write(next);
                }}
              />
            </div>
            <div className="jf-field" style={{ flex: 1 }}>
              <label className="jf-field__label" htmlFor={`${def.id}-v-${index}`}>
                {CSP_VALUELESS_DIRECTIVES.has(directive.name)
                  ? t("security.headers.csp.noValueNeeded")
                  : t("security.headers.csp.allowedSources")}
              </label>
              <input
                id={`${def.id}-v-${index}`}
                className="jf-input jf-input--mono"
                value={directive.value}
                disabled={CSP_VALUELESS_DIRECTIVES.has(directive.name)}
                placeholder="'self' https://cdn.example.com"
                onChange={(e) => {
                  const next = [...directives];
                  next[index] = { ...directive, value: e.target.value };
                  write(next);
                }}
              />
              {!CSP_VALUELESS_DIRECTIVES.has(directive.name) && (
                <div className="jf-row">
                  {CSP_SOURCE_KEYWORDS.map((keyword) => (
                    <button
                      key={keyword}
                      type="button"
                      className="jf-btn jf-btn--quiet"
                      onClick={() => {
                        const tokens = directive.value.split(/\s+/).filter(Boolean);
                        const next = [...directives];
                        next[index] = {
                          ...directive,
                          value: tokens.includes(keyword)
                            ? tokens.filter((t) => t !== keyword).join(" ")
                            : [...tokens, keyword].join(" "),
                        };
                        write(next);
                      }}
                    >
                      {directive.value.split(/\s+/).includes(keyword) ? `✓ ${keyword}` : keyword}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="jf-iconbtn jf-iconbtn--danger"
              aria-label={t("security.headers.csp.removeDirective", { name: directive.name })}
              onClick={() => write(directives.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="jf-field">
        <label className="jf-field__label" htmlFor={`${def.id}-add`}>
          {t("security.headers.csp.addDirectiveLabel")}
        </label>
        <select
          id={`${def.id}-add`}
          className="jf-input"
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            write([...directives, { name: e.target.value, value: "" }]);
            e.target.value = "";
          }}
        >
          <option value="">{t("security.headers.csp.chooseDirective")}</option>
          {CSP_DIRECTIVES.filter((d) => !used.has(d)).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function PermissionsEditor({ def, entry, onChange }: EditorProps) {
  const { t } = useT();
  const entries = useMemo(() => parsePermissionsPolicy(entry.value), [entry.value]);
  const used = new Set(entries.map((e) => e.feature));
  const write = (next: typeof entries) => onChange({ value: serializePermissionsPolicy(next) });

  return (
    <div className="jf-stack jf-stack--sm">
      <p className="jf-field__hint">
        {t("security.headers.permissions.hintPrefix")}{" "}
        <em>{t("security.headers.permissions.blockedEm")}</em>{" "}
        {t("security.headers.permissions.hintSuffix")}
      </p>

      <div className="jf-tablewrap">
        <table className="jf-table">
          <thead>
            <tr>
              <th>{t("security.headers.permissions.table.feature")}</th>
              <th>{t("security.headers.permissions.table.whoMayUse")}</th>
              <th>{t("security.headers.permissions.table.allowlist")}</th>
              <th aria-label={t("security.headers.permissions.table.removeAria")} />
            </tr>
          </thead>
          <tbody>
            {entries.map((item, index) => {
              const choice = permissionChoiceOf(item.allowlist);
              return (
                <tr key={item.feature}>
                  <td>
                    <code>{item.feature}</code>
                  </td>
                  <td>
                    <select
                      className="jf-input"
                      aria-label={t("security.headers.permissions.policyForAria", { feature: item.feature })}
                      value={choice}
                      onChange={(e) => {
                        const next = [...entries];
                        next[index] = {
                          ...item,
                          allowlist: allowlistForChoice(
                            e.target.value as PermissionChoice,
                            item.allowlist,
                          ),
                        };
                        write(next);
                      }}
                    >
                      <option value="none">{t("security.headers.permissions.policy.blocked")}</option>
                      <option value="self">{t("security.headers.permissions.policy.selfOnly")}</option>
                      <option value="all">{t("security.headers.permissions.policy.any")}</option>
                      <option value="custom">{t("security.headers.permissions.policy.custom")}</option>
                    </select>
                  </td>
                  <td>
                    <input
                      className="jf-input jf-input--mono"
                      aria-label={t("security.headers.permissions.allowlistForAria", { feature: item.feature })}
                      value={item.allowlist}
                      disabled={choice !== "custom"}
                      onChange={(e) => {
                        const next = [...entries];
                        next[index] = { ...item, allowlist: e.target.value };
                        write(next);
                      }}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="jf-iconbtn jf-iconbtn--danger"
                      aria-label={t("security.headers.permissions.removeFeatureAria", { feature: item.feature })}
                      onClick={() => write(entries.filter((_, i) => i !== index))}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="jf-field">
        <label className="jf-field__label" htmlFor={`${def.id}-addfeature`}>
          {t("security.headers.permissions.addFeatureLabel")}
        </label>
        <select
          id={`${def.id}-addfeature`}
          className="jf-input"
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            write([...entries, { feature: e.target.value, allowlist: "()" }]);
            e.target.value = "";
          }}
        >
          <option value="">{t("security.headers.permissions.chooseFeature")}</option>
          {PERMISSIONS_FEATURES.filter((f) => !used.has(f)).map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function RawEditor({ def, entry, onChange }: EditorProps) {
  const { t } = useT();
  return (
    <div className="jf-field">
      <label className="jf-field__label" htmlFor={`${def.id}-raw`}>
        {t("security.headers.raw.valueLabel", { header: def.header })}
      </label>
      <textarea
        id={`${def.id}-raw`}
        className="jf-input jf-input--mono"
        rows={4}
        value={entry.value}
        onChange={(e) => onChange({ value: e.target.value })}
      />
      <p className="jf-field__hint">
        {t("security.headers.raw.hint")}
      </p>
    </div>
  );
}
