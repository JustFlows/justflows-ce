import { FormEvent, useEffect, useState } from "react";
import { useSession } from "@components/SessionProvider";
import { useT } from "../../../i18n/I18nProvider";
import PersonalDataPanel from "./PersonalDataPanel";

type Request = {
  id: string;
  userId: string | null;
  email: string;
  displayName: string | null;
  status: "pending" | "completed" | "declined" | "cancelled";
  note: string | null;
  outcome: string | null;
  requestedAt: string;
  dueAt: string;
  handledAt: string | null;
};

async function send<T>(url: string, method: string, body?: object): Promise<{ ok: true; data: T } | { ok: false; error: string | null }> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }).catch(() => null);
  if (!res) return { ok: false, error: null };
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? null };
}

/**
 * Removal requests members sent from their own Your data page. Completing one
 * erases everywhere, keeps what the law requires, deletes the account, and
 * emails the member; declining sends them the reason.
 */
function RemovalRequests() {
  const { t } = useT();
  const [scope, setScope] = useState<"open" | "handled">("open");
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  async function load(next = scope) {
    const result = await send<{ requests: Request[] }>(`/api/privacy-requests/requests?scope=${next}`, "GET");
    setRequests(result.ok ? result.data.requests : []);
  }
  useEffect(() => { void load(scope); }, [scope]);

  const who = (request: Request) => request.displayName ?? (request.email || t("privacy.deletedAccount"));
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "");

  async function complete(request: Request) {
    if (!window.confirm(t("privacy.confirmComplete", { who: who(request) }))) return;
    setBusy(request.id);
    setNotice("");
    const result = await send(`/api/privacy-requests/requests/${request.id}/complete`, "POST", { confirm: true });
    setBusy(null);
    setNotice(result.ok ? t("privacy.completed", { who: who(request) }) : result.error ?? t("privacy.failed"));
    await load();
  }

  async function decline(event: FormEvent, request: Request) {
    event.preventDefault();
    setBusy(request.id);
    setNotice("");
    const result = await send(`/api/privacy-requests/requests/${request.id}/decline`, "POST", { reason });
    setBusy(null);
    if (result.ok) { setDeclining(null); setReason(""); }
    setNotice(result.ok ? t("privacy.declined") : result.error ?? t("privacy.failed"));
    await load();
  }

  const now = Date.now();
  return (
    <div className="jf-card">
      <div className="jf-card__head">
        <h2 className="jf-card__title">{scope === "open" ? t("privacy.openTitle") : t("privacy.handledTitle")}</h2>
        <button type="button" className="jf-btn jf-btn--ghost" onClick={() => setScope(scope === "open" ? "handled" : "open")}>
          {scope === "open" ? t("privacy.showHandled") : t("privacy.showOpen")}
        </button>
      </div>
      <div className="jf-card__body jf-stack">
        {scope === "open" && <p className="jf-field__hint">{t("privacy.openIntro")}</p>}
        {notice && <p className="jf-field__hint" role="status">{notice}</p>}
        {requests && !requests.length && <p className="jf-field__hint">{scope === "open" ? t("privacy.noneOpen") : t("privacy.noneHandled")}</p>}
        {requests?.map((request) => (
          <div key={request.id} className="jf-stack" style={{ borderTop: "1px solid var(--jf-border, #e5e7eb)", paddingTop: 12 }}>
            <div className="jf-row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
              <div>
                <strong>{who(request)}</strong>
                {request.email && request.displayName && <span className="jf-field__hint"> · {request.email}</span>}
                <p className="jf-field__hint">
                  {t("privacy.requestedOn", { date: day(request.requestedAt) })}
                  {" · "}
                  {request.status === "pending"
                    ? (Date.parse(request.dueAt) < now ? t("privacy.overdue", { date: day(request.dueAt) }) : t("privacy.dueBy", { date: day(request.dueAt) }))
                    : `${t(`privacy.status.${request.status}`)} ${day(request.handledAt)}`}
                </p>
                {request.note && <p className="jf-field__hint">{t("privacy.memberNote", { note: request.note })}</p>}
                {request.outcome && request.status !== "pending" && <p className="jf-field__hint">{request.outcome}</p>}
                {request.outcome && request.status === "pending" && <p className="jf-field__hint" role="alert">{t("privacy.unfinished", { outcome: request.outcome })}</p>}
              </div>
              {request.status === "pending" && declining !== request.id && (
                <div className="jf-row" style={{ gap: 8 }}>
                  <button type="button" className="jf-btn jf-btn--danger" disabled={busy === request.id} onClick={() => void complete(request)}>{t("privacy.complete")}</button>
                  <button type="button" className="jf-btn jf-btn--ghost" disabled={busy === request.id} onClick={() => { setDeclining(request.id); setReason(""); }}>{t("privacy.decline")}</button>
                </div>
              )}
            </div>
            {declining === request.id && (
              <form className="jf-stack" onSubmit={(event) => void decline(event, request)}>
                <label className="jf-field">
                  <span className="jf-field__label">{t("privacy.declineReason")}</span>
                  <textarea className="jf-input" rows={3} maxLength={2000} required value={reason} onChange={(event) => setReason(event.target.value)} />
                </label>
                <div className="jf-row" style={{ gap: 8 }}>
                  <button type="submit" className="jf-btn jf-btn--primary" disabled={busy === request.id || !reason.trim()}>{t("privacy.sendDecline")}</button>
                  <button type="button" className="jf-btn jf-btn--ghost" onClick={() => setDeclining(null)}>{t("privacy.cancel")}</button>
                </div>
              </form>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Data requests by email address: for people who booked, ordered, or filled
 * in a form without an account, and for anyone found by address. Covers core
 * and every active plugin, like the Personal data section on a user's page.
 */
export default function DataRequestsPage() {
  const { t } = useT();
  const { session } = useSession();
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState<string | null>(null);
  const [years, setYears] = useState("");
  const [retentionNotice, setRetentionNotice] = useState("");
  const [selfService, setSelfService] = useState<{ download: boolean; erasure: boolean } | null>(null);
  const [selfNotice, setSelfNotice] = useState("");

  useEffect(() => {
    fetch("/api/privacy-requests/settings")
      .then(async (res) => (res.ok ? ((await res.json()) as { financialRecordsYears?: number; selfServiceDownload?: boolean; selfServiceErasure?: boolean }) : null))
      .then((data) => {
        if (typeof data?.financialRecordsYears === "number") setYears(String(data.financialRecordsYears));
        if (data) setSelfService({ download: data.selfServiceDownload !== false, erasure: data.selfServiceErasure !== false });
      })
      .catch(() => undefined);
  }, []);

  async function saveRetention(event: FormEvent) {
    event.preventDefault();
    setRetentionNotice("");
    const res = await fetch("/api/privacy-requests/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ financialRecordsYears: Number(years) }) }).catch(() => null);
    const data = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : { error: t("privacy.failed") };
    setRetentionNotice(res?.ok ? t("privacy.retentionSaved") : data.error ?? t("privacy.failed"));
  }

  async function toggleSelfService(next: { download: boolean; erasure: boolean }) {
    setSelfNotice("");
    const previous = selfService;
    setSelfService(next);
    const result = await send<{ selfServiceDownload: boolean; selfServiceErasure: boolean }>("/api/privacy-requests/settings", "PUT", { selfServiceDownload: next.download, selfServiceErasure: next.erasure });
    if (result.ok) {
      setSelfService({ download: result.data.selfServiceDownload, erasure: result.data.selfServiceErasure });
      setSelfNotice(t("privacy.retentionSaved"));
    } else {
      setSelfService(previous);
      setSelfNotice(result.error ?? t("privacy.failed"));
    }
  }

  function look(event: FormEvent) {
    event.preventDefault();
    const value = email.trim().toLowerCase();
    setSubject(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null);
  }

  if (session?.role !== "administrator") {
    return <div className="jf-alert jf-alert--error" role="alert">{t("privacy.adminOnly")}</div>;
  }

  return (
    <div className="jf-page">
      <div className="jf-topbar">
        <div>
          <span className="jf-topbar__eyebrow">{t("nav.users")}</span>
          <h1 className="jf-topbar__title">{t("privacy.requestsTitle")}</h1>
        </div>
      </div>
      <RemovalRequests />
      <div className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">{t("privacy.lookUpTitle")}</h2>
        </div>
        <div className="jf-card__body jf-stack">
          <p className="jf-field__hint">{t("privacy.requestsIntro")}</p>
          <form className="jf-row" onSubmit={look}>
            <label className="jf-field">
              <span className="jf-field__label">{t("privacy.email")}</span>
              <input className="jf-input" type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <button type="submit" className="jf-btn jf-btn--primary">{t("privacy.lookUp")}</button>
          </form>
          {subject && <PersonalDataPanel key={subject} subject={{ email: subject }} label={subject} />}
        </div>
      </div>
      <div className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">{t("privacy.selfServiceTitle")}</h2>
        </div>
        <div className="jf-card__body jf-stack">
          <p className="jf-field__hint">{t("privacy.selfServiceHint")}</p>
          {selfService && (
            <>
              <label className="jf-checkrow">
                <input type="checkbox" checked={selfService.download} onChange={(event) => void toggleSelfService({ ...selfService, download: event.target.checked })} />
                <span>{t("privacy.selfDownload")}</span>
              </label>
              <label className="jf-checkrow">
                <input type="checkbox" checked={selfService.erasure} onChange={(event) => void toggleSelfService({ ...selfService, erasure: event.target.checked })} />
                <span>{t("privacy.selfErasure")}</span>
              </label>
            </>
          )}
          {selfNotice && <p className="jf-field__hint" role="status">{selfNotice}</p>}
        </div>
      </div>
      <div className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">{t("privacy.retentionTitle")}</h2>
        </div>
        <div className="jf-card__body jf-stack">
          <p className="jf-field__hint">{t("privacy.retentionHint")}</p>
          <form className="jf-row" onSubmit={(event) => void saveRetention(event)}>
            <label className="jf-field">
              <span className="jf-field__label">{t("privacy.retentionYears")}</span>
              <input className="jf-input" type="number" min={0} max={30} step={1} value={years} onChange={(event) => setYears(event.target.value)} />
            </label>
            <button type="submit" className="jf-btn jf-btn--primary">{t("privacy.save")}</button>
          </form>
          {retentionNotice && <p className="jf-field__hint" role="status">{retentionNotice}</p>}
        </div>
      </div>
    </div>
  );
}
