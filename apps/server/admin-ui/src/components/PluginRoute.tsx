import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { usePluginMenu } from "./PluginMenuProvider";
import { internalAdminPath, publicAdminPath } from "../admin-path";

/**
 * Guards an admin page owned by a plugin. The route stays in the admin bundle,
 * but it is only reachable while the plugin that registered it is installed —
 * deleting the plugin sends a direct URL back to the Plugins page.
 */
export default function PluginRoute({ children }: { children: ReactNode }) {
  const { items, loading } = usePluginMenu();
  const { pathname } = useLocation();

  if (loading) {
    return (
      <div className="jf-page">
        <div className="jf-skeleton" style={{ height: 240 }} />
      </div>
    );
  }

  // The live pathname carries the configured admin URL (e.g. /control/analytics);
  // plugin menu items always store the canonical /admin/… path.
  const internal = internalAdminPath(pathname);
  const owned = items.some(
    (item) => internal === item.path || internal.startsWith(`${item.path}/`),
  );
  if (!owned) return <Navigate to={publicAdminPath("/admin/plugins")} replace />;

  return <>{children}</>;
}
