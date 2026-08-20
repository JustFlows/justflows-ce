import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { buildNavDomains, type NavDomain, type PluginMenuItem } from "../config/admin-nav";

interface PluginMenuValue {
  /** Admin pages owned by the plugins currently installed. */
  items: PluginMenuItem[];
  /** Core domains with the plugin pages merged in. */
  domains: NavDomain[];
  loading: boolean;
  /** Re-read after an install, activation change, or delete. */
  refresh: () => Promise<void>;
}

const PluginMenuContext = createContext<PluginMenuValue | null>(null);

function isMenuItem(raw: unknown): raw is PluginMenuItem {
  if (!raw || typeof raw !== "object") return false;
  const item = raw as Record<string, unknown>;
  return (
    typeof item.pluginId === "string" &&
    typeof item.id === "string" &&
    typeof item.label === "string" &&
    typeof item.path === "string" &&
    item.path.startsWith("/admin/")
  );
}

export function PluginMenuProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<PluginMenuItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/plugins/admin-menu", { cache: "no-store" });
      if (!res.ok) {
        // A signed-out or erroring host simply contributes no extra pages.
        setItems([]);
        return;
      }
      const data = (await res.json()) as { items?: unknown };
      setItems(Array.isArray(data.items) ? data.items.filter(isMenuItem) : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ items, domains: buildNavDomains(items), loading, refresh }),
    [items, loading, refresh],
  );

  return <PluginMenuContext.Provider value={value}>{children}</PluginMenuContext.Provider>;
}

export function usePluginMenu(): PluginMenuValue {
  const ctx = useContext(PluginMenuContext);
  if (!ctx) throw new Error("usePluginMenu must be used within PluginMenuProvider");
  return ctx;
}
