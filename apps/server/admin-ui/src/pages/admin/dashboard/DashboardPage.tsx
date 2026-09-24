import { Link } from "../../../admin-router";
import { canAccessPath } from "../../../config/admin-nav";
import { useSessionRole } from "@components/SessionProvider";
import { useT } from "../../../i18n/I18nProvider";
import DashboardWelcomePanel, { useDashboardWelcome } from "./DashboardWelcomePanel";

const tiles = [
  { key: "content", href: "/admin/content", icon: "📝" },
  { key: "media", href: "/admin/media", icon: "🖼" },
  { key: "plugins", href: "/admin/plugins", icon: "🔌" },
  { key: "themes", href: "/admin/themes", icon: "🎨" },
  { key: "users", href: "/admin/users", icon: "👤" },
  { key: "settings", href: "/admin/settings", icon: "⚙" },
] as const;

export default function AdminDashboard() {
  const role = useSessionRole();
  const { t } = useT();
  const welcome = useDashboardWelcome();
  const visibleTiles = tiles.filter((tile) => role === null || canAccessPath(role, tile.href));

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("nav.dashboard")}</h1>
          <p>{t("dashboard.subtitle")}</p>
        </div>
        <div className="jf-pagehead__actions">
          <Link className="jf-btn jf-btn--ghost" to="/admin/content/new?type=page">{t("dashboard.newPage")}</Link>
          <Link className="jf-btn jf-btn--primary" to="/admin/content/new?type=post">{t("dashboard.newPost")}</Link>
        </div>
      </header>

      <DashboardWelcomePanel welcome={welcome} />

      <div className="jf-tiles">
        {visibleTiles.map((item) => (
          <Link key={item.href} to={item.href} className="jf-tile">
            <span className="jf-tile__icon" aria-hidden="true">{item.icon}</span>
            <div className="jf-tile__label">{t(`nav.${item.key}`)}</div>
            <div className="jf-tile__desc">{t(`dashboard.tiles.${item.key}`)}</div>
          </Link>
        ))}
      </div>

      {role === "administrator" && welcome.state.dismissed && (
        <p className="jf-dashboard__restore">
          <button
            type="button"
            className="jf-btn jf-btn--ghost jf-btn--sm"
            onClick={() => welcome.update({ dismissed: false })}
          >
            {t("dashboard.welcome.restore")}
          </button>
        </p>
      )}
    </div>
  );
}
