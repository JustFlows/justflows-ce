// SPDX-License-Identifier: MIT

import { Fragment, useEffect, useState, type FormEvent } from "react";
import { useT } from "../../../i18n/I18nProvider";

type Mode = "records" | "nameservers";

interface Instruction {
  type: string;
  name: string;
  value: string;
  purpose: "verify" | "route" | "nameserver";
}

interface SiteDomain {
  id: string;
  hostname: string;
  kind: "primary" | "subdomain" | "custom";
  status: "pending" | "active" | "failed";
  isPrimary: boolean;
  verified: boolean;
  mode: Mode | null;
  parentId: string | null;
  tlsStatus: "none" | "pending" | "issued" | "external";
  lastError: string | null;
  checkedAt: string | null;
  managedZone: boolean;
  instructions: Instruction[];
}

interface Access {
  available: boolean;
  allowed: boolean;
  reason: string | null;
  modes: Mode[];
  limit: number | null;
  used: number;
  upgradeUrl: string | null;
  provider: "manual" | "bunny";
  includeWww: boolean;
}

interface DnsRecord {
  id: string;
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
  managed: boolean;
}

const RECORD_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX", "CAA", "SRV"] as const;

async function domainsJson<T>(
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

/**
 * Admin → Settings → Domains. Connect a domain the site owns, either by
 * adding DNS records at the customer's own DNS host or by pointing its
 * nameservers at the platform.
 */
export default function DomainsPage() {
  const { t } = useT();
  const [access, setAccess] = useState<Access | null>(null);
  const [domains, setDomains] = useState<SiteDomain[]>([]);
  const [hostname, setHostname] = useState("");
  const [mode, setMode] = useState<Mode>("records");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [zoneOpen, setZoneOpen] = useState<string | null>(null);

  async function load() {
    const body = await domainsJson<{ access: Access; domains: SiteDomain[] }>(
      "/api/domains",
      undefined,
      t("customDomains.failed"),
    );
    setAccess(body.access);
    setDomains(body.domains);
    if (!body.access.modes.includes(mode) && body.access.modes[0]) setMode(body.access.modes[0]);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(key: string, task: () => Promise<string>) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      setNotice(await task());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("customDomains.failed"));
    } finally {
      setBusy("");
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    void run("add", async () => {
      const body = await domainsJson<{ domains: SiteDomain[] }>(
        "/api/domains",
        { method: "POST", body: JSON.stringify({ hostname, mode }) },
        t("customDomains.failed"),
      );
      setDomains(body.domains);
      setHostname("");
      await load();
      return t("customDomains.added");
    });
  }

  function check(domain: SiteDomain) {
    void run(`check:${domain.id}`, async () => {
      const body = await domainsJson<{ domains: SiteDomain[] }>(
        `/api/domains/${domain.id}/check`,
        { method: "POST" },
        t("customDomains.failed"),
      );
      setDomains(body.domains);
      const after = body.domains.find((item) => item.id === domain.id);
      return after?.status === "active"
        ? t("customDomains.nowActive", { hostname: domain.hostname })
        : t("customDomains.checked");
    });
  }

  function makePrimary(domain: SiteDomain) {
    void run(`primary:${domain.id}`, async () => {
      const body = await domainsJson<{ domains: SiteDomain[] }>(
        `/api/domains/${domain.id}/primary`,
        { method: "POST" },
        t("customDomains.failed"),
      );
      setDomains(body.domains);
      return t("customDomains.primarySet", { hostname: domain.hostname });
    });
  }

  function remove(domain: SiteDomain) {
    if (!window.confirm(t("customDomains.removeConfirm", { hostname: domain.hostname }))) return;
    void run(`remove:${domain.id}`, async () => {
      const body = await domainsJson<{ domains: SiteDomain[] }>(
        `/api/domains/${domain.id}`,
        { method: "DELETE" },
        t("customDomains.failed"),
      );
      setDomains(body.domains);
      if (zoneOpen === domain.id) setZoneOpen(null);
      await load();
      return t("customDomains.removed");
    });
  }

  const atLimit = access?.limit != null && access.used >= access.limit;

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("customDomains.title")}</h1>
          <p>{t("customDomains.description")}</p>
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

      {!access ? (
        !error && <p>{t("common.loading")}</p>
      ) : (
        <>
          {!access.available ? (
            <div className="jf-alert jf-alert--info" role="note">
              {t("customDomains.notOffered")}
            </div>
          ) : !access.allowed ? (
            <section className="jf-card">
              <div className="jf-card__head">
                <h2 className="jf-card__title">{t("customDomains.upgradeTitle")}</h2>
              </div>
              <div className="jf-card__body jf-stack">
                <p>{t("customDomains.notIncluded")}</p>
                {access.upgradeUrl && (
                  <p>
                    <a
                      className="jf-btn jf-btn--primary"
                      href={access.upgradeUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {t("customDomains.upgrade")}
                    </a>
                  </p>
                )}
              </div>
            </section>
          ) : (
            <section className="jf-card">
              <div className="jf-card__head">
                <h2 className="jf-card__title">{t("customDomains.addTitle")}</h2>
              </div>
              <form className="jf-card__body jf-stack" onSubmit={add}>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jf-domain-hostname">
                    {t("customDomains.hostname")}
                  </label>
                  <input
                    id="jf-domain-hostname"
                    className="jf-input jf-input--mono"
                    required
                    maxLength={253}
                    placeholder="example.com"
                    value={hostname}
                    onChange={(event) => setHostname(event.target.value)}
                    disabled={atLimit}
                  />
                </div>
                {access.modes.length > 1 && (
                  <fieldset className="jf-choice">
                    <legend className="jf-field__label">{t("customDomains.how")}</legend>
                    <label className="jf-checkrow">
                      <input
                        type="radio"
                        name="mode"
                        checked={mode === "records"}
                        onChange={() => setMode("records")}
                      />
                      <span>{t("customDomains.modeRecords")}</span>
                    </label>
                    <p className="jf-field__hint">{t("customDomains.modeRecordsHint")}</p>
                    <label className="jf-checkrow">
                      <input
                        type="radio"
                        name="mode"
                        checked={mode === "nameservers"}
                        onChange={() => setMode("nameservers")}
                      />
                      <span>{t("customDomains.modeNameservers")}</span>
                    </label>
                    <p className="jf-field__hint">
                      {access.includeWww
                        ? t("customDomains.modeNameserversHintWww")
                        : t("customDomains.modeNameserversHint")}
                    </p>
                  </fieldset>
                )}
                {mode === "nameservers" && (
                  <div className="jf-alert jf-alert--info" role="note">
                    {t("customDomains.nameserversWarning")}
                  </div>
                )}
                {access.limit != null && (
                  <p className="jf-field__hint">
                    {t("customDomains.usage", { used: access.used, limit: access.limit })}
                  </p>
                )}
                <div className="jf-row">
                  <button
                    className="jf-btn jf-btn--primary"
                    type="submit"
                    disabled={busy !== "" || atLimit || !hostname.trim()}
                  >
                    {busy === "add" ? t("common.saving") : t("customDomains.add")}
                  </button>
                  {atLimit && access.upgradeUrl && (
                    <a
                      className="jf-btn"
                      href={access.upgradeUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {t("customDomains.upgradeMore")}
                    </a>
                  )}
                </div>
              </form>
            </section>
          )}

          <section className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">{t("customDomains.listTitle")}</h2>
            </div>
            <div className="jf-card__body--flush jf-tablewrap">
              <table className="jf-table">
                <thead>
                  <tr>
                    <th>{t("customDomains.hostname")}</th>
                    <th>{t("customDomains.status")}</th>
                    <th>{t("customDomains.https")}</th>
                    <th>
                      <span className="jf-sr-only">{t("common.actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {domains.map((domain) => (
                    <Fragment key={domain.id}>
                      <tr>
                        <td className="jf-td--strong">
                          <span className="jf-input--mono">{domain.hostname}</span>{" "}
                          {domain.isPrimary && (
                            <span className="jf-badge jf-badge--ok">
                              {t("customDomains.primary")}
                            </span>
                          )}
                          {domain.kind !== "custom" && (
                            <div className="jf-field__hint">
                              {t("customDomains.platformAddress")}
                            </div>
                          )}
                          {domain.parentId && (
                            <div className="jf-field__hint">{t("customDomains.followsParent")}</div>
                          )}
                        </td>
                        <td>
                          <span
                            className={`jf-badge ${domain.status === "active" ? "jf-badge--ok" : domain.status === "failed" ? "jf-badge--error" : "jf-badge--warn"}`}
                          >
                            {t(
                              `customDomains.status${domain.status === "active" ? "Active" : domain.status === "failed" ? "Failed" : "Pending"}`,
                            )}
                          </span>
                          {domain.lastError && domain.status !== "active" && (
                            <div className="jf-field__hint">{domain.lastError}</div>
                          )}
                        </td>
                        <td>
                          {domain.kind !== "custom"
                            ? "—"
                            : t(
                                `customDomains.tls${domain.tlsStatus === "issued" ? "Issued" : domain.tlsStatus === "external" ? "External" : domain.tlsStatus === "pending" ? "Pending" : "None"}`,
                              )}
                        </td>
                        <td className="jf-td--actions">
                          {domain.kind === "custom" &&
                            !domain.parentId &&
                            domain.status !== "active" && (
                              <button
                                type="button"
                                className="jf-btn jf-btn--sm"
                                disabled={busy !== ""}
                                onClick={() => check(domain)}
                              >
                                {busy === `check:${domain.id}`
                                  ? t("customDomains.checking")
                                  : t("customDomains.checkNow")}
                              </button>
                            )}{" "}
                          {domain.status === "active" && !domain.isPrimary && (
                            <button
                              type="button"
                              className="jf-btn jf-btn--sm"
                              disabled={busy !== ""}
                              onClick={() => makePrimary(domain)}
                            >
                              {t("customDomains.makePrimary")}
                            </button>
                          )}{" "}
                          {domain.managedZone && (
                            <button
                              type="button"
                              className="jf-btn jf-btn--sm"
                              aria-expanded={zoneOpen === domain.id}
                              onClick={() => setZoneOpen(zoneOpen === domain.id ? null : domain.id)}
                            >
                              {t("customDomains.dnsRecords")}
                            </button>
                          )}{" "}
                          {domain.kind === "custom" && !domain.parentId && (
                            <button
                              type="button"
                              className="jf-btn jf-btn--danger jf-btn--sm"
                              disabled={busy !== ""}
                              onClick={() => remove(domain)}
                            >
                              {t("common.delete")}
                            </button>
                          )}
                        </td>
                      </tr>
                      {domain.instructions.length > 0 && (
                        <tr>
                          <td colSpan={4}>
                            <Instructions domain={domain} />
                          </td>
                        </tr>
                      )}
                      {zoneOpen === domain.id && (
                        <tr>
                          <td colSpan={4}>
                            <ZoneRecords domain={domain} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Instructions({ domain }: { domain: SiteDomain }) {
  const { t } = useT();
  const nameservers = domain.mode === "nameservers";
  return (
    <div className="jf-stack jf-stack--sm">
      <p className="jf-field__hint">
        {nameservers
          ? t("customDomains.instructionsNameservers")
          : t("customDomains.instructionsRecords")}
      </p>
      <div className="jf-tablewrap">
        <table className="jf-table">
          <thead>
            <tr>
              <th>{t("customDomains.recordType")}</th>
              <th>{t("customDomains.recordName")}</th>
              <th>{t("customDomains.recordValue")}</th>
            </tr>
          </thead>
          <tbody>
            {domain.instructions.map((item) => (
              <tr key={`${item.type}:${item.name}:${item.value}`}>
                <td>{item.type}</td>
                <td>
                  <input
                    className="jf-input jf-input--mono"
                    readOnly
                    value={item.name}
                    aria-label={t("customDomains.recordName")}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </td>
                <td>
                  <input
                    className="jf-input jf-input--mono"
                    readOnly
                    value={item.value}
                    aria-label={t("customDomains.recordValue")}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!nameservers && domain.instructions.some((item) => item.type === "ALIAS") && (
        <p className="jf-field__hint">{t("customDomains.aliasHint")}</p>
      )}
      <p className="jf-field__hint">{t("customDomains.propagation")}</p>
    </div>
  );
}

function ZoneRecords({ domain }: { domain: SiteDomain }) {
  const { t } = useT();
  const [records, setRecords] = useState<DnsRecord[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<(typeof RECORD_TYPES)[number]>("A");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [ttl, setTtl] = useState("3600");
  const [priority, setPriority] = useState("10");

  useEffect(() => {
    domainsJson<{ records: DnsRecord[] }>(
      `/api/domains/${domain.id}/records`,
      undefined,
      t("customDomains.failed"),
    )
      .then((body) => setRecords(body.records))
      .catch((err: Error) => setError(err.message));
  }, [domain.id, t]);

  async function act(task: () => Promise<{ records: DnsRecord[] }>) {
    setBusy(true);
    setError("");
    try {
      setRecords((await task()).records);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("customDomains.failed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    void act(() =>
      domainsJson<{ records: DnsRecord[] }>(
        `/api/domains/${domain.id}/records`,
        {
          method: "POST",
          body: JSON.stringify({
            type,
            name,
            value,
            ttl: Number(ttl) || 3600,
            priority: type === "MX" || type === "SRV" ? Number(priority) || 10 : null,
          }),
        },
        t("customDomains.failed"),
      ),
    ).then((ok) => {
      if (ok) {
        setName("");
        setValue("");
      }
    });
  }

  function remove(record: DnsRecord) {
    if (
      !window.confirm(
        t("customDomains.recordRemoveConfirm", { name: record.name || "@", type: record.type }),
      )
    )
      return;
    void act(() =>
      domainsJson<{ records: DnsRecord[] }>(
        `/api/domains/${domain.id}/records/${record.id}`,
        { method: "DELETE" },
        t("customDomains.failed"),
      ),
    );
  }

  return (
    <div className="jf-stack">
      <h3 className="jf-section-title">
        {t("customDomains.zoneTitle", { hostname: domain.hostname })}
      </h3>
      <p className="jf-field__hint">{t("customDomains.zoneHint")}</p>
      {error && (
        <div className="jf-alert jf-alert--error" role="alert">
          {error}
        </div>
      )}
      {!records ? (
        !error && <p>{t("common.loading")}</p>
      ) : (
        <div className="jf-tablewrap">
          <table className="jf-table">
            <thead>
              <tr>
                <th>{t("customDomains.recordType")}</th>
                <th>{t("customDomains.recordName")}</th>
                <th>{t("customDomains.recordValue")}</th>
                <th>TTL</th>
                <th>
                  <span className="jf-sr-only">{t("common.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>
                    {record.type === "PULLZONE" ? t("customDomains.recordWebsite") : record.type}
                  </td>
                  <td className="jf-input--mono">{record.name || "@"}</td>
                  <td className="jf-input--mono">
                    {record.priority != null ? `${record.priority} ` : ""}
                    {record.value}
                  </td>
                  <td>{record.ttl}</td>
                  <td className="jf-td--actions">
                    {record.managed ? (
                      <span className="jf-field__hint">{t("customDomains.recordManaged")}</span>
                    ) : (
                      <button
                        type="button"
                        className="jf-btn jf-btn--danger jf-btn--sm"
                        disabled={busy}
                        onClick={() => remove(record)}
                      >
                        {t("common.delete")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="jf-grid jf-grid--2" onSubmit={add}>
        <label className="jf-field">
          <span className="jf-field__label">{t("customDomains.recordType")}</span>
          <select
            className="jf-input"
            value={type}
            onChange={(event) => setType(event.target.value as (typeof RECORD_TYPES)[number])}
          >
            {RECORD_TYPES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="jf-field">
          <span className="jf-field__label">{t("customDomains.recordName")}</span>
          <input
            className="jf-input jf-input--mono"
            value={name}
            placeholder="@"
            maxLength={253}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="jf-field">
          <span className="jf-field__label">{t("customDomains.recordValue")}</span>
          <input
            className="jf-input jf-input--mono"
            required
            value={value}
            maxLength={2000}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <label className="jf-field">
          <span className="jf-field__label">TTL</span>
          <input
            className="jf-input"
            type="number"
            min={60}
            max={86400}
            value={ttl}
            onChange={(event) => setTtl(event.target.value)}
          />
        </label>
        {(type === "MX" || type === "SRV") && (
          <label className="jf-field">
            <span className="jf-field__label">{t("customDomains.recordPriority")}</span>
            <input
              className="jf-input"
              type="number"
              min={0}
              max={65535}
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            />
          </label>
        )}
        <div className="jf-row">
          <button className="jf-btn jf-btn--primary" type="submit" disabled={busy || !value.trim()}>
            {busy ? t("common.saving") : t("customDomains.recordAdd")}
          </button>
        </div>
      </form>
    </div>
  );
}
