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

export type EditorProps = {
  def: SecurityHeaderDef;
  entry: HeaderEntry;
  onChange: (patch: Partial<HeaderEntry>) => void;
};

/** A fixed vocabulary: show every value with what it actually does. */
export function ChoiceEditor({ def, entry, onChange }: EditorProps) {
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
            {option.recommended && <span className="jf-chip">Recommended</span>}
            <span className="jf-checkrow__meta">{option.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function HstsEditor({ def, entry, onChange }: EditorProps) {
  const parts = useMemo(() => parseHsts(entry.value), [entry.value]);
  const update = (next: Partial<typeof parts>) =>
    onChange({ value: serializeHsts({ ...parts, ...next }) });

  return (
    <div className="jf-stack jf-stack--sm">
      <div className="jf-grid jf-grid--2">
        <div className="jf-field">
          <label className="jf-field__label" htmlFor={`${def.id}-preset`}>
            How long browsers should remember
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
                {preset.label}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </div>
        <div className="jf-field">
          <label className="jf-field__label" htmlFor={`${def.id}-maxage`}>
            max-age in seconds
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
          Cover every subdomain
          <span className="jf-checkrow__meta">
            Recommended. Make sure every subdomain really does serve HTTPS first — this applies to
            all of them at once.
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
          Request inclusion in the browser preload list
          <span className="jf-checkrow__meta">
            Only tick this if you intend to submit the domain at hstspreload.org. Removal takes
            months, and every subdomain must serve HTTPS for as long as you are listed.
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
          Only send over HTTPS
          <span className="jf-checkrow__meta">
            Browsers ignore this header on plain HTTP anyway. Leave it ticked unless you are
            debugging behind a proxy that hides the real protocol.
          </span>
        </span>
      </label>

      {parts.preload && !parts.includeSubDomains && (
        <p className="jf-status jf-status--error">
          The preload list will reject this domain unless includeSubDomains is also set.
        </p>
      )}
    </div>
  );
}

export function CspEditor({ def, entry, onChange }: EditorProps) {
  const directives = useMemo(() => parseCsp(entry.value), [entry.value]);
  const used = new Set(directives.map((d) => d.name));

  const write = (next: typeof directives) => onChange({ value: serializeCsp(next) });

  return (
    <div className="jf-stack jf-stack--sm">
      <div className="jf-field">
        <label className="jf-field__label" htmlFor={`${def.id}-mode`}>
          Mode
        </label>
        <select
          id={`${def.id}-mode`}
          className="jf-input"
          value={entry.mode ?? "enforce"}
          onChange={(e) => onChange({ mode: e.target.value as "enforce" | "report-only" })}
        >
          <option value="report-only">Report only — log violations, block nothing</option>
          <option value="enforce">Enforce — block anything the policy does not allow</option>
        </select>
        <p className="jf-field__hint">
          {entry.mode === "report-only"
            ? "Sent as Content-Security-Policy-Report-Only. Start here, watch the browser console on your own pages, then switch to Enforce."
            : "Sent as Content-Security-Policy. Anything the policy misses will be blocked for real visitors."}
        </p>
      </div>

      <div className="jf-stack jf-stack--sm">
        {directives.map((directive, index) => (
          <div key={directive.name} className="jf-itemrow">
            <div className="jf-field" style={{ flex: "0 0 15rem" }}>
              <label className="jf-field__label" htmlFor={`${def.id}-d-${index}`}>
                Directive
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
                {CSP_VALUELESS_DIRECTIVES.has(directive.name) ? "No value needed" : "Allowed sources"}
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
              aria-label={`Remove ${directive.name}`}
              onClick={() => write(directives.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="jf-field">
        <label className="jf-field__label" htmlFor={`${def.id}-add`}>
          Add a directive
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
          <option value="">Choose a directive…</option>
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
  const entries = useMemo(() => parsePermissionsPolicy(entry.value), [entry.value]);
  const used = new Set(entries.map((e) => e.feature));
  const write = (next: typeof entries) => onChange({ value: serializePermissionsPolicy(next) });

  return (
    <div className="jf-stack jf-stack--sm">
      <p className="jf-field__hint">
        A feature that is not listed here keeps the browser default, which usually means it is
        allowed. Listing it and choosing <em>Blocked</em> is what switches it off.
      </p>

      <div className="jf-tablewrap">
        <table className="jf-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th>Who may use it</th>
              <th>Allowlist</th>
              <th aria-label="Remove" />
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
                      aria-label={`Policy for ${item.feature}`}
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
                      <option value="none">Blocked for everyone</option>
                      <option value="self">Your own site only</option>
                      <option value="all">Any site, including embeds</option>
                      <option value="custom">Specific origins…</option>
                    </select>
                  </td>
                  <td>
                    <input
                      className="jf-input jf-input--mono"
                      aria-label={`Allowlist for ${item.feature}`}
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
                      aria-label={`Remove ${item.feature}`}
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
          Add a feature
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
          <option value="">Choose a feature…</option>
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
  return (
    <div className="jf-field">
      <label className="jf-field__label" htmlFor={`${def.id}-raw`}>
        {def.header} value
      </label>
      <textarea
        id={`${def.id}-raw`}
        className="jf-input jf-input--mono"
        rows={4}
        value={entry.value}
        onChange={(e) => onChange({ value: e.target.value })}
      />
      <p className="jf-field__hint">
        Sent verbatim. Line breaks are rejected when you save, because a header value cannot contain
        them.
      </p>
    </div>
  );
}
