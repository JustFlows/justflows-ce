import { useEffect, useState } from "react";

interface Comment {
  id: string;
  author_name: string;
  author_email: string;
  body: string;
  status: string;
  content_title?: string;
  created_at: string;
}

const STATUS_TABS = ["pending", "approved", "spam", "trash"] as const;
type StatusTab = typeof STATUS_TABS[number];

export default function CommentsPage() {
  const [tab, setTab] = useState<StatusTab>("pending");
  const [comments, setComments] = useState<Comment[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  async function load(status: StatusTab) {
    setLoading(true);
    setSelected(new Set());
    try {
      const res = await fetch(`/api/comments?status=${status}`);
      const data = await res.json() as { comments: Comment[] };
      setComments(data.comments ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(tab); }, [tab]);

  async function bulkAction(action: "approve" | "spam" | "trash") {
    if (selected.size === 0) return;
    await fetch("/api/comments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected), action }),
    });
    load(tab);
  }

  function toggleAll() {
    setSelected(selected.size === comments.length ? new Set() : new Set(comments.map((c) => c.id)));
  }

  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

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
            onClick={() => setTab(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="jf-toolbar">
          <strong style={{ color: "var(--jf-accent)" }}>{selected.size} selected</strong>
          <button className="jf-btn jf-btn--ghost" onClick={() => bulkAction("approve")}>Approve</button>
          <button className="jf-btn jf-btn--ghost" onClick={() => bulkAction("spam")}>Mark spam</button>
          <button className="jf-btn jf-btn--danger" onClick={() => bulkAction("trash")}>Trash</button>
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
            <span className="jf-empty__icon" aria-hidden="true">💬</span>
            <span className="jf-empty__title">No {tab} comments</span>
            <p>Nothing needs your attention here right now.</p>
          </div>
        ) : (
          <>
            <div className="jf-card__head">
              <label className="jf-row" style={{ gap: "0.6rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={selected.size === comments.length}
                  onChange={toggleAll}
                />
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
                      {c.content_title && <span className="jf-meta">on: {c.content_title}</span>}
                      <span className="jf-meta" style={{ marginInlineStart: "auto" }}>
                        {new Date(c.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="jf-list__desc" style={{ lineHeight: 1.6 }}>{c.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
