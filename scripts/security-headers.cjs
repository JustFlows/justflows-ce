// SPDX-License-Identifier: MIT
"use strict";

/**
 * Baseline security headers, in CommonJS with no dependencies.
 *
 * Root `server.js` answers /, /install, /login and /assets/* itself, in front of
 * Express — so none of apps/server/src/middleware/security-headers.ts reaches
 * them. Under Passenger, cPanel or Plesk that is every page a visitor sees
 * before signing in, and they were served with nothing but Content-Type: the
 * login form was framable, and the admin bundle ran with no CSP at all.
 *
 * This module holds the values both layers use, so the pre-Express fallback and
 * the configurable engine cannot drift. security-headers.ts imports ADMIN_CSP
 * from here for the same reason.
 */

/**
 * Content-Security-Policy for the admin application and the pages that lead into it.
 *
 * The admin is a Vite build we control, so this can be strict rather than
 * aspirational — no CDN, no inline script, nothing framing it. `style-src`
 * keeps 'unsafe-inline' because React inline styles and the builder's live
 * preview both set style attributes; that is a defacement risk, not a script
 * execution one. `connect-src 'self'` keeps an injected script from posting the
 * session anywhere. blob: and data: on img-src cover media previews and the
 * favicon editor.
 */
const ADMIN_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
].join("; ");

const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "camera=()",
  "display-capture=()",
  "encrypted-media=()",
  "fullscreen=(self)",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "picture-in-picture=()",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

/**
 * Headers for a response served by root server.js.
 *
 * HSTS is sent unconditionally: a browser ignores it on a plain-HTTP response,
 * and server.js has no trust-proxy configuration, so inspecting
 * X-Forwarded-Proto here would mean trusting a header any client can set — the
 * exact thing security-headers.ts was fixed not to do.
 */
function baselineSecurityHeaders() {
  return {
    "Content-Security-Policy": ADMIN_CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": PERMISSIONS_POLICY,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-site",
    "X-Permitted-Cross-Domain-Policies": "none",
    "X-DNS-Prefetch-Control": "off",
    // The legacy filter introduced vulnerabilities of its own; 0 turns it off.
    "X-XSS-Protection": "0",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "X-Powered-By": "Justflows",
  };
}

/** Merge the baseline under caller-supplied headers (Content-Type and friends). */
function withSecurityHeaders(headers) {
  return { ...baselineSecurityHeaders(), ...headers };
}

module.exports = {
  ADMIN_CSP,
  PERMISSIONS_POLICY,
  baselineSecurityHeaders,
  withSecurityHeaders,
};
