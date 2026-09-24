import { useEffect, useState } from "react";
import { useSessionRole } from "@components/SessionProvider";
import { useT } from "../../../i18n/I18nProvider";

type TrashItem = {
  id: string;
  type: "content" | "media" | "comment" | "menu";
  label: string;
  detail: string | null;
  trashedAt: string;
  referenced?: boolean;
};

export default function TrashPage() {
  const { t } = useT();
  const canPurge = useSessionRole() === "administrator";
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/trash");
      const data = (await res.json()) as { items?: TrashItem[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? t("trash.loadFailed"));
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
      setError(data.error ?? t("trash.restoreFailed"));
      return;
    }
    setItems((current) => current.filter((candidate) => candidate !== item));
  }

  async function purge(item: TrashItem) {
    const warning = item.referenced
      ? t("trash.referencedWarning")
      : t("trash.deleteConfirm", { label: item.label });
    if (!confirm(warning)) return;
    const suffix = item.referenced ? "?confirmReferenced=true" : "";
    const res = await fetch(`/api/trash/${item.type}/${item.id}${suffix}`, { method: "DELETE" });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? t("trash.deleteFailed"));
      return;
    }
    setItems((current) => current.filter((candidate) => candidate !== item));
  }

  async function emptyTrash() {
    const referenced = items.filter((item) => item.type === "media" && item.referenced).length;
    const confirmMessage =
      t("trash.emptyConfirm", { count: items.length }) +
      (referenced ? t("trash.emptyConfirmReferencedSuffix", { count: referenced }) : "");
    if (!confirm(confirmMessage)) return;
    const res = await fetch(`/api/trash?confirmReferenced=true`, { method: "DELETE" });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? t("trash.emptyFailed"));
      return;
    }
    setItems([]);
  }

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("trash.heading")}</h1>
          <p>{t("trash.subtitle")}</p>
        </div>
        <div className="jf-pagehead__actions">
          {canPurge && (
            <button
              type="button"
              className="jf-btn jf-btn--danger"
              disabled={!items.length}
              onClick={() => void emptyTrash()}
            >
              {t("trash.emptyTrash")}
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
        <p>{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <div className="jf-card">
          <div className="jf-empty">
            <span className="jf-empty__icon" aria-hidden="true">
              ♻
            </span>
            <span className="jf-empty__title">{t("trash.emptyState")}</span>
          </div>
        </div>
      ) : (
        <div className="jf-card">
          <div className="jf-tablewrap">
            <table className="jf-table">
              <thead>
                <tr>
                  <th>{t("trash.colItem")}</th>
                  <th>{t("trash.colType")}</th>
                  <th>{t("trash.colTrashed")}</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${item.type}:${item.id}`}>
                    <td>
                      <strong>{item.label}</strong>
                      {item.detail && <div className="jf-meta">{item.detail}</div>}
                      {item.referenced && (
                        <div className="jf-status jf-status--warning">{t("trash.referencedByContent")}</div>
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
                          {t("trash.restore")}
                        </button>
                        {canPurge && (
                          <button
                            type="button"
                            className="jf-btn jf-btn--danger jf-btn--sm"
                            onClick={() => void purge(item)}
                          >
                            {t("trash.deletePermanently")}
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
