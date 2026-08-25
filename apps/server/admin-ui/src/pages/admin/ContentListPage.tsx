import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface ContentItem {
  id: string;
  type: string;
  title: string;
  slug: string;
  locale: string;
  status: string;
  updatedAt: string;
}

interface ContentTypeSummary {
  slug: string;
  label: string;
}

const STATUS_FILTERS = ["all", "draft", "published"] as const;

export default function ContentPage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [types, setTypes] = useState<ContentTypeSummary[]>([]);
  const [homePageId, setHomePageId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");

  useEffect(() => {
    fetch("/api/content")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data.items)) setItems(data.items); })
      .catch(() => {});
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: { home_page_id?: string | null }) => {
        setHomePageId(typeof data.home_page_id === "string" ? data.home_page_id : null);
      })
      .catch(() => {});
    fetch("/api/content-types")
      .then((r) => r.json())
      .then((data: { types?: ContentTypeSummary[] }) => {
        if (Array.isArray(data.types)) setTypes(data.types);
      })
      .catch(() => {});
  }, []);

  const filtered = items.filter((i) =>
    (filter === "all" || i.type === filter) &&
    (statusFilter === "all" || i.status === statusFilter)
  );

  const typeLabel = (slug: string) => types.find((t) => t.slug === slug)?.label ?? slug;
  const primaryType = types.find((t) => t.slug === "post") ?? types[0];

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>Content</h1>
          <p>Posts, pages and custom content types</p>
        </div>
        <div className="jf-pagehead__actions">
          {types.filter((t) => t.slug !== (primaryType?.slug ?? "post")).map((type) => (
            <Link key={type.slug} to={`/admin/content/new?type=${encodeURIComponent(type.slug)}`} className="jf-btn jf-btn--ghost">
              + New {type.label.toLowerCase()}
            </Link>
          ))}
          {primaryType && (
            <Link to={`/admin/content/new?type=${encodeURIComponent(primaryType.slug)}`} className="jf-btn jf-btn--primary">
              + New {primaryType.label.toLowerCase()}
            </Link>
          )}
        </div>
      </header>

      <div className="jf-filterbar">
        {["all", ...types.map((t) => t.slug)].map((t) => (
          <button
            key={t}
            className="jf-chip"
            aria-pressed={filter === t}
            onClick={() => setFilter(t)}
          >
            {t === "all" ? "All" : typeLabel(t)}
          </button>
        ))}
        <span className="jf-filterbar__sep" aria-hidden="true" />
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            className="jf-chip"
            aria-pressed={statusFilter === s}
            onClick={() => setStatusFilter(s)}
          >
            {`${s[0]!.toUpperCase()}${s.slice(1)}`}
          </button>
        ))}
        <span className="jf-meta" style={{ marginInlineStart: "auto" }}>
          {filtered.length} of {items.length}
        </span>
      </div>

      <div className="jf-card">
        {filtered.length === 0 ? (
          <div className="jf-empty">
            <span className="jf-empty__icon" aria-hidden="true">📝</span>
            <span className="jf-empty__title">Nothing here yet</span>
            <p>
              {items.length === 0
                ? "Create your first post or page to get started."
                : "No content matches the current filters."}
            </p>
          </div>
        ) : (
          <div className="jf-tablewrap">
            <table className="jf-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Type</th>
                  <th>Language</th>
                  <th>Status</th>
                  <th>Slug</th>
                  <th>Updated</th>
                  <th><span className="jf-sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td className="jf-td--strong">
                      <Link to={`/admin/content/${item.id}`}>{item.title}</Link>
                      {homePageId === item.id ? (
                        <span className="jf-badge jf-badge--published" style={{ marginInlineStart: "0.5rem" }}>Home</span>
                      ) : null}
                    </td>
                    <td>{typeLabel(item.type)}</td>
                    <td className="jf-td--mono">{item.locale ?? "—"}</td>
                    <td><StatusBadge status={item.status} /></td>
                    <td className="jf-td--mono">/{item.slug}</td>
                    <td className="jf-td--muted">{new Date(item.updatedAt).toLocaleDateString()}</td>
                    <td className="jf-td--actions">
                      <Link to={`/admin/content/${item.id}`} className="jf-btn jf-btn--quiet">Edit</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant: Record<string, string> = {
    published: " jf-badge--published",
    archived: " jf-badge--archived",
    scheduled: " jf-badge--info",
  };
  return <span className={`jf-badge${variant[status] ?? ""}`}>{status}</span>;
}
