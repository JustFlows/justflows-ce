// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useT } from "../../i18n/I18nProvider";

type Rule = {
  id?: string;
  source: string;
  kind: "exact" | "prefix" | "regex";
  targetType: "internal" | "content" | "external";
  target: string;
  status: number;
  enabled: boolean;
};
type Config = {
  rules: Rule[];
  suggestions: Rule[];
  content: Array<{ id: string; title: string; path: string }>;
};
type Entry = { path: string; hits: number; referrer: string; firstSeen: string; lastSeen: string };
const empty = (): Rule => ({
  source: "",
  kind: "exact",
  targetType: "internal",
  target: "",
  status: 301,
  enabled: true,
});
export default function RedirectsPage() {
  const { t } = useT();
  const [config, setConfig] = useState<Config | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [offset, setOffset] = useState(0);
  const [rule, setRule] = useState<Rule>(empty);
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const focusTarget = useRef(false);
  const targetRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusTarget.current) {
      targetRef.current?.focus();
      focusTarget.current = false;
    }
  }, [rule]);
  async function request(path: string, init?: RequestInit) {
    const response = await fetch(`/api/redirects${path}`, init);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? t("redirects.failed"));
    return body;
  }
  async function load(page = offset) {
    const [data, log] = await Promise.all([request(""), request(`/not-found?offset=${page}`)]);
    setConfig(data);
    setEntries(log.entries);
    setOffset(page);
  }
  function report(err: unknown) {
    setError(err instanceof Error ? err.message : t("redirects.failed"));
  }
  useEffect(() => {
    void load(0).catch(report);
  }, []);
  async function action(fn: () => Promise<void>, page = offset) {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await fn();
      setSaved(true);
      await load(page);
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }
  async function write(value: Rule) {
    const { id, ...body } = value;
    await request(id ? `/${id}` : "", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void action(async () => {
      await write(rule);
      setRule(empty());
    });
  }
  function from404(path: string) {
    focusTarget.current = true;
    setRule({ ...empty(), source: path });
    setSaved(false);
  }
  return (
    <div className="jf-page jf-stack">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("redirects.title")}</h1>
          <p>{t("redirects.description")}</p>
        </div>
      </header>
      {error && (
        <div role="alert" className="jf-alert jf-alert--error">
          {error}{" "}
          <button
            className="jf-btn"
            disabled={busy}
            onClick={() => {
              setError("");
              void load().catch(report);
            }}
          >
            {t("redirects.retry")}
          </button>
        </div>
      )}
      {saved && (
        <div role="status" className="jf-alert jf-alert--success">
          {t("redirects.saved")}
        </div>
      )}
      {!config ? (
        !error && <p>{t("common.loading")}</p>
      ) : (
        <>
          <form onSubmit={save} className="jf-card jf-card__body jf-stack">
            <h2 className="jf-card__title">{t(rule.id ? "redirects.edit" : "redirects.create")}</h2>
            <p className="jf-field__hint" id="redirect-help">
              {t("redirects.help")}
            </p>
            <fieldset
              disabled={busy}
              className="jf-stack"
              style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
            >
              <div className="jf-grid jf-grid--2">
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="redirect-source">
                    {t("redirects.source")}
                  </label>
                  <input
                    ref={sourceRef}
                    id="redirect-source"
                    className="jf-input"
                    value={rule.source}
                    maxLength={2048}
                    required
                    aria-describedby="redirect-help"
                    onChange={(e) => setRule({ ...rule, source: e.target.value })}
                  />
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="redirect-kind">
                    {t("redirects.kind")}
                  </label>
                  <select
                    id="redirect-kind"
                    className="jf-input"
                    value={rule.kind}
                    onChange={(e) => setRule({ ...rule, kind: e.target.value as Rule["kind"] })}
                  >
                    {["exact", "prefix", "regex"].map((kind) => (
                      <option key={kind} value={kind}>
                        {t(`redirects.${kind}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="redirect-target-type">
                    {t("redirects.targetType")}
                  </label>
                  <select
                    id="redirect-target-type"
                    className="jf-input"
                    value={rule.targetType}
                    onChange={(e) =>
                      setRule({
                        ...rule,
                        targetType: e.target.value as Rule["targetType"],
                        target: "",
                      })
                    }
                  >
                    {["internal", "content", "external"].map((type) => (
                      <option key={type} value={type}>
                        {t(`redirects.${type}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="redirect-target">
                    {t("redirects.target")}
                  </label>
                  {rule.targetType === "content" ? (
                    <select
                      id="redirect-target"
                      className="jf-input"
                      value={rule.target}
                      required
                      onChange={(e) => setRule({ ...rule, target: e.target.value })}
                    >
                      <option value="">{t("redirects.chooseContent")}</option>
                      {config.content.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title} — {item.path}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      ref={targetRef}
                      id="redirect-target"
                      className="jf-input"
                      value={rule.target}
                      maxLength={2048}
                      required
                      onChange={(e) => setRule({ ...rule, target: e.target.value })}
                    />
                  )}
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="redirect-status">
                    {t("redirects.status")}
                  </label>
                  <select
                    id="redirect-status"
                    className="jf-input"
                    value={rule.status}
                    onChange={(e) => setRule({ ...rule, status: Number(e.target.value) })}
                  >
                    {[301, 302, 307, 308].map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="jf-field">
                  <span>{t("redirects.enabled")}</span>
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) => setRule({ ...rule, enabled: e.target.checked })}
                  />
                </label>
              </div>
              <div className="jf-row">
                <button className="jf-btn jf-btn--primary" type="submit">
                  {t(busy ? "redirects.saving" : "redirects.save")}
                </button>
                <button className="jf-btn" type="button" onClick={() => setRule(empty())}>
                  {t("redirects.cancel")}
                </button>
              </div>
            </fieldset>
          </form>
          <section className="jf-card jf-card__body jf-stack">
            <h2 className="jf-card__title">{t("redirects.rules")}</h2>
            {!config.rules.length ? (
              <p>{t("redirects.empty")}</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="jf-table">
                  <thead>
                    <tr>
                      {["source", "kind", "target", "status", "enabled", "actions"].map((key) => (
                        <th scope="col" key={key}>
                          {t(`redirects.${key}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {config.rules.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <code>{item.source}</code>
                        </td>
                        <td>{t(`redirects.${item.kind}`)}</td>
                        <td style={{ overflowWrap: "anywhere" }}>
                          {config.content.find(
                            (c) => item.targetType === "content" && c.id === item.target,
                          )?.title ?? item.target}
                        </td>
                        <td>{item.status}</td>
                        <td>{t(item.enabled ? "redirects.yes" : "redirects.no")}</td>
                        <td>
                          <div className="jf-row">
                            <button
                              className="jf-btn"
                              disabled={busy}
                              onClick={() => {
                                setRule(item);
                                sourceRef.current?.focus();
                              }}
                            >
                              {t("redirects.edit")}
                            </button>
                            <button
                              className="jf-btn"
                              disabled={busy}
                              onClick={() =>
                                void action(async () => {
                                  await write({ ...item, enabled: !item.enabled });
                                  if (rule.id === item.id)
                                    setRule({ ...rule, enabled: !item.enabled });
                                })
                              }
                            >
                              {t(item.enabled ? "redirects.disable" : "redirects.enable")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="jf-card jf-card__body jf-stack">
            <h2 className="jf-card__title">{t("redirects.csv")}</h2>
            <p>{t("redirects.csvHelp")}</p>
            <a className="jf-btn" href="/api/redirects/export" download>
              {t("redirects.export")}
            </a>
            <label className="jf-field__label" htmlFor="redirect-file">
              {t("redirects.file")}
            </label>
            <input
              id="redirect-file"
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 1048576) {
                  setError(t("redirects.tooLarge"));
                  return;
                }
                void file.text().then(setCsv).catch(report);
              }}
            />
            <label className="jf-field__label" htmlFor="redirect-csv">
              {t("redirects.csvText")}
            </label>
            <textarea
              id="redirect-csv"
              className="jf-input"
              rows={5}
              value={csv}
              disabled={busy}
              onChange={(e) => setCsv(e.target.value)}
            />
            <button
              className="jf-btn"
              disabled={busy || !csv.trim()}
              onClick={() =>
                void action(async () => {
                  await request("/import", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ csv }),
                  });
                  setCsv("");
                })
              }
            >
              {t("redirects.import")}
            </button>
          </section>
          <section className="jf-card jf-card__body jf-stack">
            <h2 className="jf-card__title">{t("redirects.suggestions")}</h2>
            <p>{t("redirects.suggestionsHelp")}</p>
            {!config.suggestions.length ? (
              <p>{t("redirects.noSuggestions")}</p>
            ) : (
              <ul className="jf-stack">
                {config.suggestions.map((item) => (
                  <li key={item.id} style={{ overflowWrap: "anywhere" }}>
                    <code>{item.source}</code> → <code>{item.target}</code>{" "}
                    <button
                      className="jf-btn"
                      disabled={busy}
                      onClick={() => {
                        const content = config.content.find((c) => c.path === item.target);
                        setRule({
                          ...item,
                          id: undefined,
                          targetType: content ? "content" : "internal",
                          target: content?.id ?? item.target,
                        });
                        sourceRef.current?.focus();
                      }}
                    >
                      {t("redirects.review")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="jf-card jf-card__body jf-stack">
            <h2 className="jf-card__title">{t("redirects.notFound")}</h2>
            <p>{t("redirects.logHelp")}</p>
            <button
              className="jf-btn"
              disabled={busy || !entries.length}
              onClick={() =>
                void action(async () => {
                  await request("/not-found", { method: "DELETE" });
                }, 0)
              }
            >
              {t("redirects.clear")}
            </button>
            {!entries.length ? (
              <p>{t("redirects.no404")}</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="jf-table">
                  <thead>
                    <tr>
                      {["source", "hits", "referrer", "firstSeen", "lastSeen", "actions"].map(
                        (key) => (
                          <th scope="col" key={key}>
                            {t(`redirects.${key}`)}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.path}>
                        <td>
                          <code>{entry.path}</code>
                        </td>
                        <td>{entry.hits}</td>
                        <td style={{ overflowWrap: "anywhere" }}>{entry.referrer || "—"}</td>
                        <td>{entry.firstSeen}</td>
                        <td>{entry.lastSeen}</td>
                        <td>
                          <button
                            className="jf-btn"
                            disabled={busy}
                            onClick={() => from404(entry.path)}
                          >
                            {t("redirects.createFrom404")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="jf-row">
              <button
                className="jf-btn"
                disabled={busy || offset === 0}
                onClick={() => void load(Math.max(0, offset - 100)).catch(report)}
              >
                {t("redirects.previous")}
              </button>
              <button
                className="jf-btn"
                disabled={busy || entries.length < 100}
                onClick={() => void load(offset + 100).catch(report)}
              >
                {t("redirects.next")}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
