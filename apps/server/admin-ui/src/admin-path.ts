import { getAdminSsrPayload } from "./ssr-data";

/**
 * Pages served before a session can exist. The server never embeds SSR data
 * (session, plugin menu, site identity) on these — they're a bare
 * `res.sendFile(index.html)` (see `withCsrfCookie` in server.ts) — so any
 * client-side fetch that needs a session or renders only inside the
 * authenticated shell should skip itself here instead of firing a request
 * guaranteed to 401/404 and littering the console with it.
 */
export const PRE_AUTH_PATHS = [
  "/install",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/oauth/consent",
  "/signup",
] as const;

export function isPreAuthPath(pathname: string): boolean {
  return (PRE_AUTH_PATHS as readonly string[]).includes(pathname) || adminAuthPage(pathname) !== null;
}

export const ADMIN_AUTH_PAGES = ["login", "forgot-password", "reset-password"] as const;
export type AdminAuthPage = (typeof ADMIN_AUTH_PAGES)[number];

const ADMIN_AUTH = /^(\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)\/(login|forgot-password|reset-password)\/?$/;

/**
 * The staff auth page `pathname` is — `<admin path>/login`, `/forgot-password`
 * or `/reset-password` — with the admin base path, otherwise null. These pages
 * are bare documents served before a session exists, so there is no SSR payload
 * to read the base from and it comes from the URL instead; the server only
 * serves them under the configured path. A real admin page always carries a
 * payload, which keeps a plugin route ending in `/login` from matching.
 */
export function adminAuthPage(pathname: string = currentPathname()): { base: string; page: AdminAuthPage } | null {
  if (getAdminSsrPayload()) return null;
  const match = ADMIN_AUTH.exec(pathname);
  return match ? { base: match[1]!, page: match[2] as AdminAuthPage } : null;
}

/**
 * The real (browser) URL, not React Router's virtual location — `/login` and
 * `/admin` are two different server-rendered documents (see `server.ts`),
 * never a client-side route transition, so this only needs to be correct at
 * mount time, and reading it this way means callers don't need a `<Router>`
 * ancestor at all (useful for tests, and one less thing to wire up).
 * `entry-server.tsx` never renders the admin app for a pre-auth page, so
 * defaulting to "not pre-auth" when `window` is undefined is always correct
 * for the real SSR pass, not just a safe fallback.
 */
export function currentPathname(): string {
  return typeof window === "undefined" ? "" : window.location.pathname;
}

// The SSR payload is JSON parsed out of a <script> element's text content, so
// every field is treated as untrusted. The admin base path flows into link
// hrefs, history entries and `window.location`, so it is validated here, at the
// single point it enters the app: it must be a rooted path built only from
// path-safe characters — no scheme (`javascript:`), no protocol-relative
// `//host`, no HTML metacharacters. Anything else falls back to `/admin`.
const ADMIN_BASE_PATH = /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

export function adminBasePath(): string {
  const raw = getAdminSsrPayload()?.adminBasePath;
  return typeof raw === "string" && ADMIN_BASE_PATH.test(raw) ? raw : "/admin";
}

export function publicAdminPath(path: string): string {
  const base = adminBasePath();
  if (
    base !== "/admin" &&
    (path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}?`) || path.startsWith(`${base}#`))
  ) return path;
  if (!/^\/admin(?:\/|\?|#|$)/.test(path)) return path;
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
