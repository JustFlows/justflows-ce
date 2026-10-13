// SPDX-License-Identifier: MIT

import { accountCacheMiddleware } from "../../middleware/account-cache.js";
import type { Request, Response, NextFunction } from "express";
import type { PluginHttpMethod, PluginHttpRateLimit } from "@justflows/sdk";
import { isProtectedHeaderName, SECURITY_HEADER_DEFS } from "../security/security-headers.js";
import { resolveSession } from "../auth/auth-session.js";
import { getTenantContext } from "../tenancy/context.js";
import { sessionMatchesRequestSite } from "../tenancy/access.js";
import { recordDiagnosticError } from "../runtime/diagnostics.js";
import { parseLocalePrefix } from "../i18n/locales.js";

/**
 * Headers a plugin may not set on the response.
 *
 * Plugin output used to be copied over the response verbatim, so a handler
 * could replace the Content-Security-Policy the platform had just set, widen
 * Access-Control-Allow-Origin, or plant a Set-Cookie. Plugins already run
 * in-process — this is not a sandbox — but silently disarming a site-wide
 * security header is a different thing from running code, and nothing about it
 * would be visible to the operator.
 */
const RESERVED_RESPONSE_HEADERS = new Set<string>([
  ...SECURITY_HEADER_DEFS.map((def) => def.header.toLowerCase()),
  "content-security-policy",
  "content-security-policy-report-only",
  "strict-transport-security",
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "set-cookie",
]);

/** Request headers never forwarded to plugin code. */
const STRIPPED_REQUEST_HEADERS = new Set(["cookie", "authorization", "proxy-authorization"]);

/** Never assign these as plain object keys sourced from request data. */
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Public Forms submit is still CSRF-exempt here because that plugin lives
 * outside this repo and has not yet registered `csrf: false` on the route.
 * The host also rate-limits that path in `register-routes.ts`. Every other
 * exemption comes from the route the plugin registered.
 */
const PUBLIC_PLUGIN_MUTATIONS = new Set(["POST /justflows-forms/submit"]);

export function requiresPluginCsrf(
  method: PluginHttpMethod,
  path: string,
  route?: { csrf?: false },
): boolean {
  if (method === "GET") return false;
  if (route?.csrf === false) return false;
  if (PUBLIC_PLUGIN_MUTATIONS.has(`${method} ${path}`)) return false;
  return true;
}

/** Host counter for a route that asked for one. The name is the plugin's, prefixed with its id. */
export function pluginRouteRateBucket(route: {
  pluginId: string;
  path: string;
  rateLimit?: PluginHttpRateLimit;
}): { bucket: string; limit: number; windowMs: number } | null {
  const limit = route.rateLimit;
  if (!limit) return null;
  const name = limit.key ?? route.path;
  return {
    bucket: `plugin:${route.pluginId}:${name}`,
    limit: limit.limit,
    windowMs: limit.windowMs,
  };
}

export function isReservedPluginResponseHeader(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return RESERVED_RESPONSE_HEADERS.has(lower) || isProtectedHeaderName(lower);
}

/**
 * The visitor's language for a plugin route. Storefront scripts call
 * `/ext/<id>/...` from a page such as `/nl-NL/shop`; the same-origin Referer
 * carries that page's locale prefix. Anything else gets the site default.
 */
export function pluginRequestLocale(
  req: Pick<Request, "path" | "get">,
  activeLocales: string[],
  defaultLocale: string,
): string {
  const own = parseLocalePrefix(req.path, activeLocales).locale;
  if (own) return own;
  const referer = req.get("referer");
  const host = req.get("host");
  if (referer && host) {
    try {
      const url = new URL(referer);
      if (url.host === host) {
        const fromPage = parseLocalePrefix(url.pathname, activeLocales).locale;
        if (fromPage) return fromPage;
      }
    } catch {
      // malformed Referer: fall through to the default
    }
  }
  return defaultLocale;
}

/** Whether the request's site has this plugin active. Single-site requests have no allowlist to apply. */
export function pluginActiveForRequest(pluginId: string): boolean {
  const ctx = getTenantContext();
  if (!ctx) return true;
  return ctx.activePluginIds !== null && ctx.activePluginIds.has(pluginId);
}

/** Shared API guard envelope, opt-in so legacy plugin clients keep their contract. */
export function pluginHttpErrorBody(structured: boolean | undefined, status: number, message: string, requestId?: string | null): Record<string, unknown> {
  if (!structured) return { error: message, ...(requestId ? { requestId } : {}) };
  const codes: Record<number, string> = { 400: "invalid_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 429: "rate_limited", 500: "internal_error" };
  return { error: { code: codes[status] ?? "request_failed", message, ...(requestId ? { requestId } : {}) } };
}

export async function dispatchPluginHttp(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { ensurePluginRuntime, getPluginLoader } = await import("./plugin-runtime.js");
  await ensurePluginRuntime();
  const loader = getPluginLoader();
  if (!loader) {
    next();
    return;
  }

  const method: PluginHttpMethod | null =
    req.method === "GET" ||
    req.method === "POST" ||
    req.method === "PUT" ||
    req.method === "PATCH" ||
    req.method === "DELETE"
      ? req.method
      : null;
  if (!method) {
    next();
    return;
  }

  const matched = loader.httpRouter.match(method, req.path);
  if (!matched) {
    next();
    return;
  }
  const { route: match, params } = matched;

  // The router is process-wide; a route only exists on sites where its plugin
  // is active. An unknown allowlist fails closed.
  if (!pluginActiveForRequest(match.pluginId)) {
    next();
    return;
  }

  // These routes are mounted at the application root, not under /api, so the
  // csrfProtection middleware never sees them — every plugin mutation was
  // cross-site forgeable. Checked here, on the one path that reaches them.
  // A route opts into a ceiling and out of CSRF when it is registered.
  const ceiling = pluginRouteRateBucket(match);
  if (ceiling) {
    const { clientIp, consumeRateLimit } = await import("../security/rate-limit.js");
    if (!consumeRateLimit(`${ceiling.bucket}:${clientIp(req)}`, ceiling.limit, ceiling.windowMs)) {
      res.status(429).json(pluginHttpErrorBody(match.structuredErrors, 429, "Too many requests"));
      return;
    }
  }

  // A management API key stands in for the cookie. It is no ambient credential,
  // so its requests skip CSRF, and a cookie sent with it is ignored.
  const { resolvePluginKeySession } = await import("./plugin-http-key.js");
  const keyed = await resolvePluginKeySession(req, res);
  if (keyed.kind === "limited") return;
  if (keyed.kind === "denied") {
    res.status(401).json(pluginHttpErrorBody(match.structuredErrors, 401, "Unauthorized"));
    return;
  }

  if (keyed.kind === "none" && requiresPluginCsrf(method, req.path, match)) {
    const { csrfProtection } = await import("../../middleware/csrf.js");
    // Synchronous: it either calls next() or answers 403 itself, so the flag
    // is settled by the time the call returns.
    let passed = false;
    const originalJson = res.json;
    if (match.structuredErrors) {
      res.json = function (body: unknown) {
        const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "Invalid CSRF token";
        return originalJson.call(this, pluginHttpErrorBody(true, 403, message));
      };
    }
    try {
      csrfProtection(req, res, () => { passed = true; });
    } finally { res.json = originalJson; }
    if (!passed) return;
  }

  try {
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (UNSAFE_OBJECT_KEYS.has(key)) continue;
      if (typeof value === "string") query[key] = value;
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (UNSAFE_OBJECT_KEYS.has(key)) continue;
      if (typeof value !== "string") continue;
      if (STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) continue;
      headers[key] = value;
    }

    // Same rule as the core auth middleware: a cookie only counts on the site it was issued for.
    const resolved = keyed.kind === "ok" ? null : await resolveSession(req, res).catch(() => null);
    const cookieSession = resolved && sessionMatchesRequestSite(resolved.siteId) ? resolved : null;
    const access = cookieSession
      ? await import("../auth/access-policy.js").then(({ getEffectiveAccess }) =>
          getEffectiveAccess(cookieSession.userId, cookieSession.siteId, cookieSession.role),
        )
      : null;
    const session = keyed.kind === "ok"
      ? keyed.session
      : cookieSession
        ? {
            userId: cookieSession.userId,
            siteId: cookieSession.siteId,
            role: cookieSession.role,
            roles: access?.roles ?? [cookieSession.role],
            email: cookieSession.email,
            capabilities: access?.capabilities ?? [],
            scopes: access?.policy.scopes ?? {},
          }
        : null;

    const locale = await import("../i18n/languages-db.js")
      .then(async ({ getActiveLocaleCodes, getDefaultLocale }) =>
        pluginRequestLocale(req, await getActiveLocaleCodes(), await getDefaultLocale()),
      )
      .catch(() => undefined);

    const result = await match.handler({
      method,
      ...(locale ? { locale } : {}),
      path: req.path,
      query,
      params,
      body: req.body,
      ...(match.rawBody === true && (req as { rawBody?: string }).rawBody !== undefined
        ? { rawBody: (req as { rawBody?: string }).rawBody }
        : {}),
      headers,
      session,
    });

    const status = result.status ?? 200;
    res.status(status);
    // A public read that a statically-exported page fetches cross-origin can opt
    // into CORS. The allow-list (site origins + STATIC_EXPORT_ALLOWED_ORIGINS +
    // localhost off-prod) is the host's — plugins cannot set Access-Control-* .
    if (result.cors === true) {
      const { applyFormCors } = await import("../static-export/cors.js");
      applyFormCors(req.get("origin"), (name, value) => res.setHeader(name, value));
    }
    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) {
        if (isReservedPluginResponseHeader(key)) {
          console.warn(
            `[justflows] plugin "${match.pluginId}" tried to set the reserved header "${key}"`,
          );
          continue;
        }
        res.setHeader(key, value);
      }
    }
    // A plugin cannot override the host’s private account cache policy.
    accountCacheMiddleware(req, res, () => undefined);
    if (result.type) res.type(result.type);

    if (result.file && typeof result.file.key === "string") {
      const { sendPrivateFile } = await import("../files/private-file-response.js");
      await sendPrivateFile(req, res, match.pluginId, result.file);
      return;
    }

    if (Buffer.isBuffer(result.body) || typeof result.body === "string") {
      res.send(result.body);
    } else if (result.body !== undefined) {
      res.json(result.body);
    } else {
      res.end();
    }

    // A route that mutated something public pages reflect (a setting injected
    // via `html.head`, a block's stored config) can ask for site-wide cache
    // revalidation — which is also what wakes the static-export auto-rebuild.
    // Fire-and-forget after the response so it never adds request latency.
    if (result.revalidate === true && method !== "GET" && status < 400) {
      void import("../cache/cache-revalidate.js")
        .then((m) =>
          m.revalidateOnUpdate("plugin", session?.siteId ? { siteId: session.siteId } : undefined),
        )
        .catch(() => {
          // revalidation is best-effort; a failure must not surface to the plugin
        });
    }
  } catch (err) {
    const routeLabel = `${match.pluginId}${req.path}`.replace(/\r/g, "").replace(/\n/g, "");
    const diagnostic = recordDiagnosticError(`plugin:${match.pluginId} route ${req.path}`, err);
    console.error("[justflows] plugin route failed: %s", JSON.stringify(routeLabel), err);
    if (!res.headersSent)
      res.status(500).json(pluginHttpErrorBody(match.structuredErrors, 500, "Internal server error", diagnostic.requestId));
  }
}
