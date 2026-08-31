import { useEffect, useState } from "react";

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
}

const STATUS_TABS = ["pending", "approved", "spam", "trash"] as const;
type StatusTab = (typeof STATUS_TABS)[number];
const PAGE_SIZE = 30;

export default function CommentsPage() {
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
    if (selected.size === 0 || !confirm(`Permanently delete ${selected.size} comment(s)?`)) return;
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
    const next = prompt("Edit comment", stripTags(c.body));
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
    const text = prompt(`Reply to ${c.author_name}`);
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
          <h1>Comments</h1>
          <p>Moderate discussion across your site</p>
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
            {s}
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="jf-toolbar">
          <strong style={{ color: "var(--jf-accent)" }}>{selected.size} selected</strong>
          {tab !== "approved" && (
            <button className="jf-btn jf-btn--ghost" disabled={busy} onClick={() => bulkAction("approve")}>
              Approve
            </button>
          )}
          {tab === "approved" && (
            <button className="jf-btn jf-btn--ghost" disabled={busy} onClick={() => bulkAction("pending")}>
              Unapprove
            </button>
          )}
          {tab !== "spam" && (
            <button className="jf-btn jf-btn--ghost" disabled={busy} onClick={() => bulkAction("spam")}>
              Mark spam
            </button>
          )}
          {tab !== "trash" && (
            <button className="jf-btn jf-btn--danger" disabled={busy} onClick={() => bulkAction("trash")}>
              Trash
            </button>
          )}
          {tab === "trash" && (
            <button className="jf-btn jf-btn--danger" disabled={busy} onClick={hardDelete}>
              Delete permanently
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
            <span className="jf-empty__title">No {tab} comments</span>
            <p>Nothing needs your attention here right now.</p>
          </div>
        ) : (
          <>
            <div className="jf-card__head">
              <label className="jf-row" style={{ gap: "0.6rem", cursor: "pointer" }}>
                <input type="checkbox" checked={selected.size === comments.length} onChange={toggleAll} />
                <span className="jf-card__title">Select all</span>
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
                    aria-label={`Select comment by ${c.author_name}`}
                  />
                  <div className="jf-list__main">
                    <div className="jf-row" style={{ gap: "0.6rem", marginBottom: "0.15rem" }}>
                      <strong style={{ fontSize: "0.875rem" }}>{c.author_name}</strong>
                      <span className="jf-meta">{c.author_email}</span>
                      {c.parent_id && <span className="jf-meta">↳ reply</span>}
                      {c.content_title &&
                        (c.content_slug ? (
                          <a className="jf-meta" href={`/${c.content_slug}`} target="_blank" rel="noreferrer">
                            on: {c.content_title}
                          </a>
                        ) : (
                          <span className="jf-meta">on: {c.content_title}</span>
                        ))}
                      <span className="jf-meta" style={{ marginInlineStart: "auto" }}>
                        {new Date(c.created_at).toLocaleDateString()}
                        {c.edited_at ? " · edited" : ""}
                      </span>
                    </div>
                    <div
                      className="jf-list__desc"
                      style={{ lineHeight: 1.6 }}
                      dangerouslySetInnerHTML={{ __html: c.body }}
                    />
                    <div className="jf-row" style={{ gap: "0.5rem", marginTop: "0.4rem" }}>
                      <button className="jf-btn jf-btn--ghost jf-btn--sm" disabled={busy} onClick={() => reply(c)}>
                        Reply
                      </button>
                      <button className="jf-btn jf-btn--ghost jf-btn--sm" disabled={busy} onClick={() => editBody(c)}>
                        Edit
                      </button>
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
            ← Previous
          </button>
          <span className="jf-meta">
            Page {page} of {totalPages}
          </span>
          <button
            className="jf-btn jf-btn--ghost"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function stripTags(html: string): string {
  return html
    .replace(/<\/(p|div|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
