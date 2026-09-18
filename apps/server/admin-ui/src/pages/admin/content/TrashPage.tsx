import { useEffect, useState } from "react";
import { useSessionRole } from "@components/SessionProvider";

type TrashItem = {
  id: string;
  type: "content" | "media" | "comment" | "menu";
  label: string;
  detail: string | null;
  trashedAt: string;
  referenced?: boolean;
};

export default function TrashPage() {
  const canPurge = useSessionRole() === "administrator";
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/trash");
      const data = (await res.json()) as { items?: TrashItem[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not load trash");
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function restore(item: TrashItem) {
    setError("");
    const res = await fetch(`/api/trash/${item.type}/${item.id}/restore`, { method: "POST" });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Could not restore item");
      return;
    }
    setItems((current) => current.filter((candidate) => candidate !== item));
  }

  async function purge(item: TrashItem) {
    const warning = item.referenced
      ? "This media file is still referenced by content. Delete it permanently anyway?"
      : `Permanently delete “${item.label}”? This cannot be undone.`;
    if (!confirm(warning)) return;
    const suffix = item.referenced ? "?confirmReferenced=true" : "";
    const res = await fetch(`/api/trash/${item.type}/${item.id}${suffix}`, { method: "DELETE" });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Could not delete item");
      return;
    }
    setItems((current) => current.filter((candidate) => candidate !== item));
  }

  async function emptyTrash() {
    const referenced = items.filter((item) => item.type === "media" && item.referenced).length;
    if (
      !confirm(
        `Permanently delete all ${items.length} items?${referenced ? ` ${referenced} referenced media file(s) will also be deleted.` : ""}`,
      )
    )
      return;
    const res = await fetch(`/api/trash?confirmReferenced=true`, { method: "DELETE" });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Could not empty trash");
      return;
    }
    setItems([]);
  }

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>Trash</h1>
          <p>Recoverable content, media, comments and menus</p>
        </div>
        <div className="jf-pagehead__actions">
          {canPurge && (
            <button
              type="button"
              className="jf-btn jf-btn--danger"
              disabled={!items.length}
              onClick={() => void emptyTrash()}
            >
              Empty trash
            </button>
          )}
        </div>
      </header>
      {error && (
        <div className="jf-alert jf-alert--error" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <p>Loading…</p>
      ) : items.length === 0 ? (
        <div className="jf-card">
          <div className="jf-empty">
            <span className="jf-empty__icon" aria-hidden="true">
              ♻
            </span>
            <span className="jf-empty__title">Trash is empty</span>
          </div>
        </div>
      ) : (
        <div className="jf-card">
          <div className="jf-tablewrap">
            <table className="jf-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Type</th>
                  <th>Trashed</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${item.type}:${item.id}`}>
                    <td>
                      <strong>{item.label}</strong>
                      {item.detail && <div className="jf-meta">{item.detail}</div>}
                      {item.referenced && (
                        <div className="jf-status jf-status--warning">Referenced by content</div>
                      )}
                    </td>
                    <td>{item.type}</td>
                    <td>{new Date(item.trashedAt).toLocaleString()}</td>
                    <td>
                      <div className="jf-row">
                        <button
                          type="button"
                          className="jf-btn jf-btn--sm"
                          onClick={() => void restore(item)}
                        >
                          Restore
                        </button>
                        {canPurge && (
                          <button
                            type="button"
                            className="jf-btn jf-btn--danger jf-btn--sm"
                            onClick={() => void purge(item)}
                          >
                            Delete permanently
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
