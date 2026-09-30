// SPDX-License-Identifier: MIT

import { useEffect, useState, type FormEvent } from "react";
import { useT } from "../../../i18n/I18nProvider";
import MediaImageField from "../../../components/MediaImageField";

interface PlaceholderKindRow {
  kind: string;
  label: string;
  owner: string;
  defaultSrc: string;
  width: number;
  height: number;
  custom: { url: string; width: number; height: number } | null;
}

interface PlaceholderState {
  enabled: boolean;
  kinds: PlaceholderKindRow[];
}

export default function PlaceholdersPage() {
  const { t } = useT();
  const [state, setState] = useState<PlaceholderState | null>(null);
  // Chosen image per kind; "" means "use the default".
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);

  function accept(body: PlaceholderState) {
    setState(body);
    setDraft(Object.fromEntries(body.kinds.map((row) => [row.kind, row.custom?.url ?? ""])));
  }

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/settings/placeholders");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? t("placeholders.failed"));
      accept(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("placeholders.failed"));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!state) return;
    setSaving(true);
    setError("");
    setSaved("");
    try {
      const images = Object.fromEntries(
        state.kinds.map((row) => [row.kind, draft[row.kind] ? { url: draft[row.kind] } : null]),
      );
      const response = await fetch("/api/settings/placeholders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: state.enabled, images }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? t("placeholders.failed"));
      accept(body);
      setSaved(t("placeholders.saved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("placeholders.failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("placeholders.title")}</h1>
          <p>{t("placeholders.description")}</p>
        </div>
      </header>
      {error && (
        <div role="alert" className="jf-alert jf-alert--error">
          {error}{" "}
          {!state && (
            <button className="jf-btn" onClick={() => void load()}>
              {t("placeholders.retry")}
            </button>
          )}
        </div>
      )}
      {saved && (
        <div role="status" className="jf-alert jf-alert--success">
          {saved}
        </div>
      )}
      {!state ? (
        !error && <p>{t("common.loading")}</p>
      ) : (
        <form onSubmit={save} className="jf-stack">
          <fieldset
            disabled={saving}
            className="jf-stack"
            style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
            aria-label={t("placeholders.title")}
          >
            <section className="jf-card">
              <div className="jf-card__body jf-stack">
                <label className="jf-checkrow">
                  <input
                    type="checkbox"
                    checked={state.enabled}
                    onChange={(e) => setState({ ...state, enabled: e.target.checked })}
                  />
                  <span>{t("placeholders.enable")}</span>
                </label>
                <p className="jf-field__hint">{t("placeholders.enableHint")}</p>
              </div>
            </section>

            <section className="jf-card">
              <div className="jf-card__head">
                <h2 className="jf-card__title">{t("placeholders.images")}</h2>
              </div>
              <div className="jf-card__body jf-grid jf-grid--2">
                {state.kinds.map((row) => {
                  // Core kinds are translated here; plugin kinds keep their registered label.
                  const label =
                    row.owner === "core" ? t(`placeholders.kinds.${row.kind}`) : row.label;
                  return (
                    <div className="jf-field" key={row.kind}>
                      <MediaImageField
                        id={`placeholder-${row.kind}`}
                        label={label}
                        description={t("placeholders.kindHint", {
                          size: `${row.width}×${row.height}`,
                          owner: row.owner === "core" ? t("placeholders.ownerCore") : row.owner,
                        })}
                        value={draft[row.kind] ?? ""}
                        onChange={(url) => setDraft({ ...draft, [row.kind]: url })}
                        square={row.width === row.height}
                      />
                      {!draft[row.kind] && (
                        <img
                          src={row.defaultSrc}
                          alt={t("placeholders.defaultPreview", { label })}
                          style={{
                            maxWidth: 200,
                            aspectRatio: `${row.width} / ${row.height}`,
                            borderRadius: 6,
                            border: "1px solid var(--jf-border, #e2e8f0)",
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <div>
              <button type="submit" className="jf-btn jf-btn--primary">
                {saving ? t("placeholders.saving") : t("placeholders.save")}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </div>
  );
}
