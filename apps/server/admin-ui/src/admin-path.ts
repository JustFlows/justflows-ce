import { getAdminSsrPayload } from "./ssr-data";

export function adminBasePath(): string {
  return getAdminSsrPayload()?.adminBasePath || "/admin";
}

export function publicAdminPath(path: string): string {
  const base = adminBasePath();
  if (path !== "/admin" && !path.startsWith("/admin/")) return path;
  return `${base}${path.slice("/admin".length)}`;
}

export function internalAdminPath(path: string): string {
  const base = adminBasePath();
  if (path !== base && !path.startsWith(`${base}/`)) return path;
  return `/admin${path.slice(base.length)}`;
}

/** Keep existing navigation calls compatible while exposing the configured URL. */
export function installAdminPathNavigation(): void {
  if (typeof window === "undefined" || adminBasePath() === "/admin") return;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = ((data: unknown, unused: string, url?: string | URL | null) => {
      if (url == null) return original(data, unused, url);
      const parsed = new URL(String(url), window.location.href);
      if (parsed.origin === window.location.origin) {
        parsed.pathname = publicAdminPath(parsed.pathname);
        return original(data, unused, `${parsed.pathname}${parsed.search}${parsed.hash}`);
      }
      return original(data, unused, url);
    }) as History[typeof method];
  }
}
