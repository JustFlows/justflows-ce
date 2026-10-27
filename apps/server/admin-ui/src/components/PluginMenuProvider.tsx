import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ContentTypeMenu } from "../lib/content-type-navigation";
import { buildNavDomains, type NavDomain, type PluginMenuItem } from "../config/admin-nav";
import { initialJson } from "../ssr-data";
import { useSession } from "./SessionProvider";

interface PluginMenuValue {
  /** Admin pages owned by the plugins currently installed. */
  items: PluginMenuItem[];
  contentTypes: ContentTypeMenu[];
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
  const { session, loading: sessionLoading } = useSession();
  const initial = initialJson<{ items?: unknown }>("/api/plugins/admin-menu")?.items;
  const initialItems = Array.isArray(initial) ? initial.filter(isMenuItem) : [];
  const [contentTypes, setContentTypes] = useState<ContentTypeMenu[]>(() => initialJson<{ types?: ContentTypeMenu[] }>("/api/content-types")?.types ?? []);
  const [items, setItems] = useState<PluginMenuItem[]>(initialItems);
  const [loading, setLoading] = useState(!Array.isArray(initial));

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
    // No point asking for admin-only plugin pages before a session exists —
    // it only ever 401s (every consumer of this menu renders inside the
    // authenticated shell anyway) and SessionProvider skips itself on
    // pre-auth pages, where `session` never resolves at all. While the
    // session check is still in flight, leave `loading` alone rather than
    // flipping it to false early — that would let a consumer (PluginHostPage)
    // read an empty menu as "confirmed empty" and navigate away before the
    // real fetch below ever gets a chance to run.
    if (sessionLoading) return;
    if (!session) {
      setItems([]);
      setLoading(false);
      return;
    }
    void refresh();
  }, [sessionLoading, session, refresh]);

  useEffect(() => {
    if (!session || sessionLoading) return;
    let cancelled = false;
    async function refreshTypes() {
      try {
        const res = await fetch("/api/content-types");
        if (!res.ok) return;
        const data = await res.json() as { types?: ContentTypeMenu[] };
        if (!cancelled && Array.isArray(data.types)) setContentTypes(data.types);
      } catch {}
    }
    void refreshTypes();
    window.addEventListener("jf-content-types-changed", refreshTypes);
    return () => { cancelled = true; window.removeEventListener("jf-content-types-changed", refreshTypes); };
  }, [session, sessionLoading]);

  const value = useMemo(
    () => ({ items, contentTypes, domains: buildNavDomains(items), loading, refresh }),
    [items, contentTypes, loading, refresh],
  );

  return <PluginMenuContext.Provider value={value}>{children}</PluginMenuContext.Provider>;
}

/** The installed plugins' admin pages, or none outside a `PluginMenuProvider`. */
export function usePluginMenuItems(): PluginMenuItem[] {
  return useContext(PluginMenuContext)?.items ?? [];
}

export function usePluginMenu(): PluginMenuValue {
  const ctx = useContext(PluginMenuContext);
  if (!ctx) throw new Error("usePluginMenu must be used within PluginMenuProvider");
  return ctx;
}

/** Shared catalog for navigation and dashboard shortcuts; empty outside the shell. */
export function useContentTypeMenu(): ContentTypeMenu[] {
  return useContext(PluginMenuContext)?.contentTypes ?? [];
}
