import { useState } from "react";
import { useT } from "../../../i18n/I18nProvider";

/** One person: a site account, or a guest known only by an email address. */
export type PersonalDataSubject = { userId: string } | { email: string };

interface PluginPart {
  id: string;
  label: string;
  ok: boolean;
  counts?: Record<string, number>;
  count?: number;
  kept?: Array<{ kind: string; count: number; until: string; reason: string }>;
  notes: string[];
  error?: string;
}

interface Erasure {
  contentReassigned: number;
  commentsAnonymised: number;
  auditEntriesAnonymised: number;
  plugins: PluginPart[];
}

interface ExportSummary {
  subject: { userId: string | null; email: string };
  content: unknown[];
  comments: unknown[];
  auditEntries: unknown[];
  plugins: PluginPart[];
}

function exportUrl(subject: PersonalDataSubject): string {
  return "userId" in subject
    ? `/api/users/${encodeURIComponent(subject.userId)}/personal-data`
    : `/api/privacy-requests/export?email=${encodeURIComponent(subject.email)}`;
}

/**
 * Download everything the site keeps about one person, from core and every
 * active plugin, or erase it (GDPR Art. 15 and 17). The only place for data
 * requests: plugins contribute through the `privacy.providers` filter.
 */
export default function PersonalDataPanel({ subject, label }: { subject: PersonalDataSubject; label: string }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [found, setFound] = useState<ExportSummary | null>(null);
  const [erased, setErased] = useState<Erasure | null>(null);

  async function download() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(exportUrl(subject));
      const data = (await res.json()) as ExportSummary & { error?: string };
      if (!res.ok) throw new Error(data.error ?? t("privacy.failed"));
      setFound(data);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `personal-data-${"userId" in subject ? subject.userId : "guest"}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("privacy.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function erase() {
    if (!window.confirm(t("privacy.confirmErase", { who: label }))) return;
    setBusy(true);
    setError("");
    try {
      const res = "userId" in subject
        ? await fetch(`/api/users/${encodeURIComponent(subject.userId)}/erase`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
        : await fetch("/api/privacy-requests/erase", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: subject.email, confirm: true }) });
      const data = (await res.json()) as Erasure & { error?: string };
      if (!res.ok) throw new Error(data.error ?? t("privacy.failed"));
      setErased(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("privacy.failed"));
    } finally {
      setBusy(false);
    }
  }

  const total = (counts?: Record<string, number>) => Object.values(counts ?? {}).reduce((sum, n) => sum + n, 0);

  return (
    <div className="jf-stack">
      <p className="jf-field__hint">{t("privacy.intro")}</p>
      {error && <div className="jf-alert jf-alert--error" role="alert">{error}</div>}
      <div className="jf-row">
        <button type="button" className="jf-btn" disabled={busy} onClick={() => void download()}>{t("privacy.download")}</button>
        <button type="button" className="jf-btn jf-btn--danger" disabled={busy} onClick={() => void erase()}>{t("privacy.erase")}</button>
      </div>
      {found && (
        <div className="jf-stack" aria-live="polite">
          <strong>{t("privacy.foundTitle")}</strong>
          <ul className="jf-list">
            <li>{t("privacy.core", { content: found.content.length, comments: found.comments.length, audit: found.auditEntries.length })}</li>
            {found.plugins.map((part) => (
              <li key={part.id}>{part.ok ? t("privacy.pluginFound", { name: part.label, count: part.count ?? 0 }) : t("privacy.pluginFailed", { name: part.label, error: part.error ?? "" })}</li>
            ))}
          </ul>
        </div>
      )}
      {erased && (
        <div className="jf-stack" aria-live="polite">
          <strong>{t("privacy.erasedTitle")}</strong>
          <ul className="jf-list">
            <li>{t("privacy.coreErased", { content: erased.contentReassigned, comments: erased.commentsAnonymised, audit: erased.auditEntriesAnonymised })}</li>
            {erased.plugins.map((part) => (
              <li key={part.id}>
                {part.ok ? t("privacy.pluginErased", { name: part.label, count: total(part.counts) }) : t("privacy.pluginFailed", { name: part.label, error: part.error ?? "" })}
                {(part.kept ?? []).map((item) => (
                  <div key={item.kind} className="jf-field__hint">{t("privacy.kept", { kind: item.kind, count: item.count, until: new Date(item.until).toLocaleDateString(), reason: item.reason })}</div>
                ))}
                {part.notes.map((note) => <div key={note} className="jf-field__hint">{note}</div>)}
              </li>
            ))}
          </ul>
          {erased.plugins.some((part) => !part.ok) && <p className="jf-field__hint">{t("privacy.retry")}</p>}
        </div>
      )}
    </div>
  );
}
