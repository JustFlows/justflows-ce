import { FormEvent, useEffect, useState } from "react";
import { useSession } from "@components/SessionProvider";
import { useT } from "../../../i18n/I18nProvider";
import PersonalDataPanel from "./PersonalDataPanel";

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

  useEffect(() => {
    fetch("/api/privacy-requests/settings")
      .then(async (res) => (res.ok ? ((await res.json()) as { financialRecordsYears?: number }) : null))
      .then((data) => { if (typeof data?.financialRecordsYears === "number") setYears(String(data.financialRecordsYears)); })
      .catch(() => undefined);
  }, []);

  async function saveRetention(event: FormEvent) {
    event.preventDefault();
    setRetentionNotice("");
    const res = await fetch("/api/privacy-requests/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ financialRecordsYears: Number(years) }) }).catch(() => null);
    const data = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : { error: t("privacy.failed") };
    setRetentionNotice(res?.ok ? t("privacy.retentionSaved") : data.error ?? t("privacy.failed"));
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
      <div className="jf-card">
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
