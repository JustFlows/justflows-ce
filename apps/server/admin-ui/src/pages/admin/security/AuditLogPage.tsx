import { useCallback, useEffect, useState } from "react";
import { Section } from "./components";

type Entry = {
  id: string;
  occurredAt: string;
  action: string;
  outcome: string;
  actorEmail: string | null;
  actorRole: string | null;
  target: string | null;
  ip: string | null;
  detail: string | null;
};

type Payload = { entries: Entry[]; actions: string[]; retentionDays: number };

/**
 * The administrative audit trail.
 *
 * Answers the question asked in the hour after something goes wrong: who did
 * this, from where, and when. Nothing recorded it before.
 */
export default function AuditLogPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (action: string) => {
    try {
      const qs = action ? `?action=${encodeURIComponent(action)}` : "";
      const res = await fetch(`/api/audit${qs}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      setData((await res.json()) as Payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [load, filter]);

  const prune = async () => {
    setBusy(true);
    await fetch("/api/audit/prune", { method: "POST" }).catch(() => null);
    setBusy(false);
    void load(filter);
  };

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>Audit log</h1>
          <p>Sign-ins, privilege changes, and everything that installs or replaces code.</p>
        </div>
      </header>

      <Section
        title="Recent activity"
        action={
          <select
            className="jf-input"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter by action"
          >
            <option value="">All actions</option>
            {(data?.actions ?? []).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        }
      >
        {error ? <p className="jf-status jf-status--error">{error}</p> : null}

        {!data ? (
          <p className="jf-skeleton" />
        ) : data.entries.length === 0 ? (
          <p>Nothing recorded yet for this filter.</p>
        ) : (
          <div className="jf-tablewrap">
            <table className="jf-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Who</th>
                  <th>Target</th>
                  <th>From</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="jf-td--muted">{e.occurredAt}</td>
                    <td className="jf-td--strong">
                      {e.action}
                      {e.outcome !== "success" ? (
                        <span className="jf-badge jf-badge--error"> {e.outcome}</span>
                      ) : null}
                      {e.detail ? <div className="jf-td--muted">{e.detail}</div> : null}
                    </td>
                    <td>
                      {e.actorEmail ?? "—"}
                      {e.actorRole ? <div className="jf-td--muted">{e.actorRole}</div> : null}
                    </td>
                    <td className="jf-td--muted">{e.target ?? "—"}</td>
                    <td className="jf-td--muted">{e.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Retention">
        <p>
          The current retention window is {data?.retentionDays ?? 365} days. If no custom value is
          configured, Justflows uses the default of 365 days. To change it, set{" "}
          <code className="jf-code">JF_AUDIT_RETENTION_DAYS</code> in the server environment and
          restart the application. This page does not change the server environment.
        </p>
        <p>
          <strong>Apply retention now</strong> permanently deletes audit entries older than the
          current window. It does not delete newer entries; if none are old enough, zero entries
          will be removed. Retention is necessary because the log contains personal data such as IP
          addresses.
        </p>
        <div className="jf-row">
          <button className="jf-btn" type="button" onClick={prune} disabled={busy}>
            {busy ? "Removing…" : "Apply retention now"}
          </button>
        </div>
      </Section>
    </div>
  );
}
