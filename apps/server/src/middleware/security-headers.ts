// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from "express";
import {
  defaultConfig,
  getSecurityHeadersConfig,
  resolveHeaders,
  type RequestArea,
} from "../lib/security-headers.js";

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
const ADMIN_PATH_RE = /^\/(admin|api|login|register|install|assets)(\/|$)/;

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
  const ctx = { area: requestArea(req.path), secure: isSecureRequest(req) };

  if (killSwitchEngaged()) {
    apply(res, defaultConfig(), ctx);
    next();
    return;
  }

  getSecurityHeadersConfig()
    .then(async (config) => {
      apply(res, config, ctx);
      if (config.removeServerHeader) res.removeHeader("Server");
      if (ctx.area === "public") {
        const { getConfiguredGoogleTagId } = await import("../lib/analytics-public.js");
        const { googleTagInlineHashes, withGoogleTagCsp } = await import("../lib/google-tag.js");
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

        const { getCaptchaProviderForCsp, withCaptchaCsp } = await import(
          "../lib/comments-captcha-csp.js"
        );
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
      }
    })
    .catch(() => {
      // Never let a configuration problem cost the visitor their response —
      // but never let it strip their protection either.
      apply(res, defaultConfig(), ctx);
    })
    .finally(next);
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
