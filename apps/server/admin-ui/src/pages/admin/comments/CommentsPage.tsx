import { useEffect, useState } from "react";
import { sanitizeRichText } from "@justflows/blocks";
import { useT } from "../../../i18n/I18nProvider";

interface Comment {
  id: string;
  parent_id: string | null;
  content_id: string;
  author_name: string;
  author_email: string;
  author_url?: string | null;
  body: string;
  status: string;
  content_title?: string;
  content_slug?: string;
  created_at: string;
  edited_at?: string | null;
  spam_score?: number | null;
  spam_reasons?: string | null;
  held_reason?: string | null;
  ip_address?: string | null;
}

function emailDomainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at === -1 ? null : email.slice(at + 1).trim().toLowerCase() || null;
}

const HELD_REASON_LABEL_KEYS: Record<string, string> = {
  blocklist: "comments.heldReason.blocklist",
  external_spam: "comments.heldReason.externalSpam",
  score: "comments.heldReason.score",
  moderation: "comments.heldReason.moderation",
  first_time: "comments.heldReason.firstTime",
};

/** Turn a raw stored reason code into a moderator-readable label. */
function describeReason(reason: string, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const [code, detail] = reason.split(/:(.*)/s);
  switch (code) {
    case "links":
      return t("comments.reasonLinks", { count: detail, plural: detail === "1" ? "" : "s" });
    case "keywords":
      return t("comments.reasonKeywords", { count: detail, plural: detail === "1" ? "" : "s" });
    case "disposable_email":
      return t("comments.reasonDisposableEmail");
    case "repetitive":
      return t("comments.reasonRepetitive");
    case "form_token_missing":
      return t("comments.reasonNoToken");
    case "form_too_fast":
      return t("comments.reasonTooFast");
    case "trained":
      return t("comments.reasonTrained", { detail });
    case "rule": {
      const field = (detail ?? "").replace("author_", "").replace("_", " ");
      return t("comments.reasonRule", { field });
    }
    case "external":
      return t("comments.reasonExternal", { detail: detail || t("comments.flaggedFallback") });
    default:
      return reason;
  }
}

function parseSpamReasons(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

const STATUS_TABS = ["pending", "approved", "spam", "trash"] as const;
type StatusTab = (typeof STATUS_TABS)[number];
const PAGE_SIZE = 30;

const STATUS_TAB_LABEL_KEYS: Record<StatusTab, string> = {
  pending: "comments.tabPending",
  approved: "comments.tabApproved",
  spam: "comments.tabSpam",
  trash: "comments.tabTrash",
};

export default function CommentsPage() {
  const { t } = useT();
  const [tab, setTab] = useState<StatusTab>("pending");
  const [comments, setComments] = useState<Comment[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);

  async function load(status: StatusTab, toPage: number) {
    setLoading(true);
    setSelected(new Set());
    try {
      const res = await fetch(`/api/comments?status=${status}&page=${toPage}&limit=${PAGE_SIZE}`);
      const data = (await res.json()) as { comments: Comment[]; total: number };
      setComments(data.comments ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(tab, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, page]);

  function switchTab(next: StatusTab) {
    setPage(1);
    setTab(next);
  }

  async function bulkAction(action: "approve" | "pending" | "spam" | "trash") {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await fetch("/api/comments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), action }),
      });
      await load(tab, page);
    } finally {
      setBusy(false);
    }
  }

  async function hardDelete() {
    if (selected.size === 0 || !confirm(t("comments.deleteConfirm", { count: selected.size }))) return;
    setBusy(true);
    try {
      await fetch("/api/comments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      await load(tab, page);
    } finally {
      setBusy(false);
    }
  }

  async function editBody(c: Comment) {
    const next = prompt(t("comments.editCommentPrompt"), stripTags(c.body));
    if (next == null || !next.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/comments/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: next }),
      });
      await load(tab, page);
    } finally {
      setBusy(false);
    }
  }

  async function reply(c: Comment) {
    const text = prompt(t("comments.replyToPrompt", { name: c.author_name }));
    if (text == null || !text.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/comments/${c.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      await load(tab, page);
    } finally {
      setBusy(false);
    }
  }

  async function blockPattern(field: "author_email" | "author_domain" | "ip", pattern: string) {
    if (
      !confirm(
        t("comments.blockConfirm", { field: field.replace("author_", ""), pattern }),
      )
    )
      return;
    setBusy(true);
    try {
      await fetch("/api/comment-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ list: "block", field, pattern }),
      });
    } finally {
      setBusy(false);
    }
  }

  function toggleAll() {
    setSelected(selected.size === comments.length ? new Set() : new Set(comments.map((c) => c.id)));
  }

  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("comments.heading")}</h1>
          <p>{t("comments.subtitle")}</p>
        </div>
      </header>

      <div className="jf-tabs" role="tablist">
        {STATUS_TABS.map((s) => (
          <button
            key={s}
            role="tab"
            className="jf-tab"
            aria-selected={tab === s}
            onClick={() => switchTab(s)}
          >
            {t(STATUS_TAB_LABEL_KEYS[s])}
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="jf-toolbar">
          <strong style={{ color: "var(--jf-accent)" }}>{t("comments.selectedCount", { count: selected.size })}</strong>
          {tab !== "approved" && (
            <button className="jf-btn jf-btn--ghost" disabled={busy} onClick={() => bulkAction("approve")}>
              {t("comments.approve")}
            </button>
          )}
          {tab === "approved" && (
            <button className="jf-btn jf-btn--ghost" disabled={busy} onClick={() => bulkAction("pending")}>
              {t("comments.unapprove")}
            </button>
          )}
          {tab !== "spam" && (
            <button className="jf-btn jf-btn--ghost" disabled={busy} onClick={() => bulkAction("spam")}>
              {t("comments.markSpam")}
            </button>
          )}
          {tab !== "trash" && (
            <button className="jf-btn jf-btn--danger" disabled={busy} onClick={() => bulkAction("trash")}>
              {t("comments.trashAction")}
            </button>
          )}
          {tab === "trash" && (
            <button className="jf-btn jf-btn--danger" disabled={busy} onClick={hardDelete}>
              {t("comments.deletePermanently")}
            </button>
          )}
        </div>
      )}

      <div className="jf-card">
        {loading ? (
          <div className="jf-card__body jf-stack--sm jf-stack">
            <div className="jf-skeleton" style={{ height: 56 }} />
            <div className="jf-skeleton" style={{ height: 56 }} />
            <div className="jf-skeleton" style={{ height: 56 }} />
          </div>
        ) : comments.length === 0 ? (
          <div className="jf-empty">
            <span className="jf-empty__icon" aria-hidden="true">
              💬
            </span>
            <span className="jf-empty__title">{t("comments.noComments", { tab: t(STATUS_TAB_LABEL_KEYS[tab]) })}</span>
            <p>{t("comments.emptyHint")}</p>
          </div>
        ) : (
          <>
            <div className="jf-card__head">
              <label className="jf-row" style={{ gap: "0.6rem", cursor: "pointer" }}>
                <input type="checkbox" checked={selected.size === comments.length} onChange={toggleAll} />
                <span className="jf-card__title">{t("comments.selectAll")}</span>
              </label>
            </div>
            <div className="jf-list">
              {comments.map((c) => (
                <div key={c.id} className="jf-list__row">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggleOne(c.id)}
                    style={{ marginTop: "0.3rem" }}
                    aria-label={t("comments.selectCommentAria", { name: c.author_name })}
                  />
                  <div className="jf-list__main">
                    <div className="jf-row" style={{ gap: "0.6rem", marginBottom: "0.15rem" }}>
                      <strong style={{ fontSize: "0.875rem" }}>{c.author_name}</strong>
                      <span className="jf-meta">{c.author_email}</span>
                      {c.parent_id && <span className="jf-meta">↳ {t("comments.replyIndicator")}</span>}
                      {c.content_title &&
                        (c.content_slug ? (
                          <a className="jf-meta" href={`/${c.content_slug}`} target="_blank" rel="noreferrer">
                            {t("comments.onContent", { title: c.content_title })}
                          </a>
                        ) : (
                          <span className="jf-meta">{t("comments.onContent", { title: c.content_title })}</span>
                        ))}
                      <span className="jf-meta" style={{ marginInlineStart: "auto" }}>
                        {new Date(c.created_at).toLocaleDateString()}
                        {c.edited_at ? ` · ${t("comments.editedLabel")}` : ""}
                      </span>
                    </div>
                    {typeof c.spam_score === "number" && c.spam_score > 0 && (
                      <div
                        className="jf-meta"
                        style={{
                          margin: "0.15rem 0 0.4rem",
                          padding: "0.35rem 0.6rem",
                          background: "var(--jf-surface-2, rgba(127,127,127,0.08))",
                          borderRadius: "0.35rem",
                        }}
                      >
                        <strong>{t("comments.spamScore", { score: c.spam_score })}</strong>
                        {c.held_reason &&
                          ` — ${
                            HELD_REASON_LABEL_KEYS[c.held_reason]
                              ? t(HELD_REASON_LABEL_KEYS[c.held_reason])
                              : c.held_reason
                          }`}
                        {parseSpamReasons(c.spam_reasons).length > 0 && (
                          <ul style={{ margin: "0.25rem 0 0", paddingInlineStart: "1.1rem" }}>
                            {parseSpamReasons(c.spam_reasons).map((reason, i) => (
                              <li key={i}>{describeReason(reason, t)}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    <div
                      className="jf-list__desc"
                      style={{ lineHeight: 1.6 }}
                      dangerouslySetInnerHTML={{ __html: sanitizeRichText(c.body) }}
                    />
                    <div className="jf-row" style={{ gap: "0.5rem", marginTop: "0.4rem" }}>
                      <button className="jf-btn jf-btn--ghost jf-btn--sm" disabled={busy} onClick={() => reply(c)}>
                        {t("comments.reply")}
                      </button>
                      <button className="jf-btn jf-btn--ghost jf-btn--sm" disabled={busy} onClick={() => editBody(c)}>
                        {t("comments.edit")}
                      </button>
                      {c.author_email && (
                        <button
                          className="jf-btn jf-btn--ghost jf-btn--sm"
                          disabled={busy}
                          onClick={() => blockPattern("author_email", c.author_email)}
                        >
                          {t("comments.blockEmail")}
                        </button>
                      )}
                      {emailDomainOf(c.author_email ?? "") && (
                        <button
                          className="jf-btn jf-btn--ghost jf-btn--sm"
                          disabled={busy}
                          onClick={() => blockPattern("author_domain", emailDomainOf(c.author_email)!)}
                        >
                          {t("comments.blockDomain")}
                        </button>
                      )}
                      {c.ip_address && (
                        <button
                          className="jf-btn jf-btn--ghost jf-btn--sm"
                          disabled={busy}
                          onClick={() => blockPattern("ip", c.ip_address!)}
                        >
                          {t("comments.blockIp")}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {totalPages > 1 && (
        <div className="jf-row" style={{ gap: "0.75rem", justifyContent: "center", marginTop: "1rem" }}>
          <button
            className="jf-btn jf-btn--ghost"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← {t("comments.previous")}
          </button>
          <span className="jf-meta">
            {t("comments.pageOf", { page, totalPages })}
          </span>
          <button
            className="jf-btn jf-btn--ghost"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            {t("comments.next")} →
          </button>
        </div>
      )}
    </div>
  );
}

function stripTags(html: string): string {
  return new DOMParser().parseFromString(sanitizeRichText(html), "text/html").body.textContent?.trim() ?? "";
}
