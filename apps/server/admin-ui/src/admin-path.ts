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

/**
 * Confine a server-supplied post-authentication redirect to a same-origin path.
 * `redirectTo` comes back in an auth response body, so it is treated as
 * untrusted: only a single leading slash is accepted. `//host` and `/\host`
 * (the browser folds the backslash to a slash) would be protocol-relative and
 * could send the browser off-site, and anything with a scheme — `javascript:`
 * included — fails the leading-slash test outright. Everything else falls back
 * to the caller-supplied in-app path.
 */
export function safeRedirectPath(target: unknown, fallback: string): string {
  if (typeof target !== "string") return fallback;
  if (!target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\")) {
    return fallback;
  }
  return target;
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
