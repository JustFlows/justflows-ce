import { Link } from "react-router-dom";
import { canAccessPath } from "../../config/admin-nav";
import { useSessionRole } from "@components/SessionProvider";

const tiles = [
  { label: "Content", href: "/admin/content", icon: "📝", description: "Manage posts and pages" },
  { label: "Media", href: "/admin/media", icon: "🖼", description: "Upload and manage files" },
  { label: "Plugins", href: "/admin/plugins", icon: "🔌", description: "Install and manage plugins" },
  { label: "Themes", href: "/admin/themes", icon: "🎨", description: "Customize your site's look" },
  { label: "Users", href: "/admin/users", icon: "👤", description: "Manage site members" },
  { label: "Settings", href: "/admin/settings", icon: "⚙", description: "Configure your site" },
];

export default function AdminDashboard() {
  const role = useSessionRole();
  const visibleTiles = tiles.filter((tile) => role === null || canAccessPath(role, tile.href));

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>Dashboard</h1>
          <p>Everything you need to run your site, in one place.</p>
        </div>
        <div className="jf-pagehead__actions">
          <Link className="jf-btn jf-btn--ghost" to="/admin/content/new?type=page">+ New page</Link>
          <Link className="jf-btn jf-btn--primary" to="/admin/content/new?type=post">+ New post</Link>
        </div>
      </header>

      <div className="jf-tiles">
        {visibleTiles.map((item) => (
          <Link key={item.href} to={item.href} className="jf-tile">
            <span className="jf-tile__icon" aria-hidden="true">{item.icon}</span>
            <div className="jf-tile__label">{item.label}</div>
            <div className="jf-tile__desc">{item.description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
