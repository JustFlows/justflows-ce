import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { usePluginMenu } from "./PluginMenuProvider";

/**
 * Guards an admin page owned by a plugin. The route stays in the SPA bundle,
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

  const owned = items.some(
    (item) => pathname === item.path || pathname.startsWith(`${item.path}/`),
  );
  if (!owned) return <Navigate to="/admin/plugins" replace />;

  return <>{children}</>;
}
