// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from "express";
import {
  defaultConfig,
  getSecurityHeadersConfig,
  resolveHeaders,
  type RequestArea,
} from "../lib/security/security-headers.js";
import {
  crossOriginResourcePolicyForHosts,
  frameAncestorsListsOrigins,
  getSiteCspOrigins,
  withSiteOriginCsp,
} from "../lib/security/site-origin-csp.js";
import { getAdminPathConfig, toInternalAdminPath } from "../lib/admin/admin-path.js";

/**
 * Escape hatch. A policy that locks the owner out of the admin has to be
 * recoverable without database access, so setting this in the environment
 * drops back to the shipped defaults on the next request.
 */
function killSwitchEngaged(): boolean {
  const flag = process.env.JF_SECURITY_HEADERS_DISABLED;
  return flag === "1" || flag === "true";
}

/** Everything the site owner does not theme is treated as the admin surface. */
const ADMIN_PATH_RE = /^\/(admin|api|login|register|install|assets|account|platform-account)(\/|$)/;

export function requestArea(path: string): RequestArea {
  return ADMIN_PATH_RE.test(path) ? "admin" : "public";
}

/**
 * `req.secure` is authoritative now that the app sets `trust proxy` (see
 * server.ts), because Express only honours X-Forwarded-Proto from a trusted
 * hop. Reading the header directly, as this used to, meant any client could
 * assert its own connection was secure.
 */
export function isSecureRequest(req: Request): boolean {
  return req.secure;
}

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  Promise.all([
    getAdminPathConfig(),
    killSwitchEngaged() ? defaultConfig() : getSecurityHeadersConfig(),
  ])
    .then(async ([adminPath, config]) => {
      const internalPath = toInternalAdminPath(req.path, adminPath.path) ?? req.path;
      const ctx = { area: res.locals.jfPrivateContent ? "admin" as const : requestArea(internalPath), secure: isSecureRequest(req) };
      apply(res, config, ctx);
      if (config.removeServerHeader) res.removeHeader("Server");
      if (ctx.area === "public") {
        const { getThemeMediaOriginsForCsp, withThemeMediaCsp } = await import("../lib/themes/theme-media-csp.js");
        try {
          const origins = await getThemeMediaOriginsForCsp();
          if (origins.length) {
            for (const name of ["Content-Security-Policy", "Content-Security-Policy-Report-Only"]) {
              const current = res.getHeader(name);
              if (typeof current === "string") res.setHeader(name, withThemeMediaCsp(current, origins));
            }
          }
        } catch { /* Retain the owner's original policy if theme discovery fails. */ }

        const { getConfiguredGoogleTagId } = await import("../lib/rendering/analytics-public.js");
        const { googleTagInlineHashes, withGoogleTagCsp } = await import("../lib/rendering/google-tag.js");
        const googleTagId = await getConfiguredGoogleTagId();
        if (googleTagId) {
          const hashes = googleTagInlineHashes(googleTagId);
          for (const name of ["Content-Security-Policy", "Content-Security-Policy-Report-Only"]) {
            const current = res.getHeader(name);
            const value = Array.isArray(current)
              ? current.join("; ")
              : typeof current === "string"
                ? current
                : "";
            if (value) res.setHeader(name, withGoogleTagCsp(value, hashes));
          }
        }

        const { getCaptchaProviderForCsp, withCaptchaCsp } =
          await import("../lib/comments/comments-captcha-csp.js");
        const captchaProvider = await getCaptchaProviderForCsp();
        if (captchaProvider !== "none") {
          for (const name of ["Content-Security-Policy", "Content-Security-Policy-Report-Only"]) {
            const current = res.getHeader(name);
            const value = Array.isArray(current)
              ? current.join("; ")
              : typeof current === "string"
                ? current
                : "";
            if (value) res.setHeader(name, withCaptchaCsp(value, captchaProvider));
          }
        }

        // Exported pages carry an inline `window.__JF_ORIGIN__` stamp. The hash
        // is harmless on server-rendered pages, so allow it on every public one.
        try {
          const { getStaticExportConfig } = await import("../lib/static-export/config.js");
          const { withOriginStampCsp } = await import("../lib/static-export/origin-stamp.js");
          const { originUrl } = getStaticExportConfig();
          for (const name of ["Content-Security-Policy", "Content-Security-Policy-Report-Only"]) {
            const current = res.getHeader(name);
            const value = Array.isArray(current)
              ? current.join("; ")
              : typeof current === "string"
                ? current
                : "";
            if (value) res.setHeader(name, withOriginStampCsp(value, originUrl));
          }
        } catch {
          // A broken export config must not cost the page its other CSP additions.
        }
      }
      // Plugins name the third-party hosts their pages load (Stripe, and so on)
      // before the site's own addresses are added to those same directives.
      try {
        const { getRuntimeHooks } = await import("../lib/plugins/plugin-runtime.js");
        const hooks = getRuntimeHooks();
        if (hooks.has("security.cspSources")) {
          const { getSiteId } = await import("../lib/settings/site-settings.js");
          const { applyCspSources } = await import("../lib/security/csp-sources.js");
          const siteId = (await getSiteId()) ?? "";
          const contribution = await hooks.applyFilter(
            "security.cspSources",
            {},
            { siteId, area: ctx.area },
            { siteId, source: "http" },
          );
          for (const name of ["Content-Security-Policy", "Content-Security-Policy-Report-Only"]) {
            const value = headerValue(res.getHeader(name));
            if (value) res.setHeader(name, applyCspSources(value, contribution));
          }
        }
      } catch {
        // A plugin that throws keeps the policy already on the response.
      }
      // Run after the other CSP additions so their new directives pick up the
      // site's own addresses too. A lookup failure keeps the owner's policy.
      try {
        const origins = await getSiteCspOrigins();
        if (origins.length) {
          for (const name of ["Content-Security-Policy", "Content-Security-Policy-Report-Only"]) {
            const value = headerValue(res.getHeader(name));
            if (value) {
              res.setHeader(name, withSiteOriginCsp(value, origins, { frameAncestors: ctx.area === "public" }));
            }
          }
          const corp = headerValue(res.getHeader("Cross-Origin-Resource-Policy"));
          if (corp) res.setHeader("Cross-Origin-Resource-Policy", crossOriginResourcePolicyForHosts(corp, origins));
          // SAMEORIGIN cannot name the platform address. frame-ancestors does.
          const enforced = headerValue(res.getHeader("Content-Security-Policy"));
          if (ctx.area === "public" && frameAncestorsListsOrigins(enforced)) {
            res.removeHeader("X-Frame-Options");
          }
        }
      } catch {
        // The site can still be served with the policy the owner configured.
      }
    })
    .catch(() => {
      // Never let a configuration problem cost the visitor their response —
      // but never let it strip their protection either.
      apply(res, defaultConfig(), { area: requestArea(req.path), secure: isSecureRequest(req) });
    })
    .finally(next);
}

function headerValue(current: number | string | string[] | undefined): string {
  if (Array.isArray(current)) return current.join("; ");
  if (typeof current === "string") return current;
  return "";
}

function apply(
  res: Response,
  config: Parameters<typeof resolveHeaders>[0],
  ctx: Parameters<typeof resolveHeaders>[1],
): void {
  if (ctx.area === "admin") {
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  for (const { name, value } of resolveHeaders(config, ctx)) {
    res.setHeader(name, value);
  }
}
