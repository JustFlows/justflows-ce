// SPDX-License-Identifier: MIT

import type { PwaSettings } from "./pwa-settings.js";

function escAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

/**
 * `<link rel="manifest">` / theme-color tag for the public document head.
 * Callers must skip this when `headExtra` already contains a `rel="manifest"`
 * tag (a theme or plugin providing its own) rather than emitting a duplicate.
 */
export function buildPwaHeadHtml(settings: PwaSettings): string {
  if (!settings.enabled) return "";
  return [
    `<link rel="manifest" href="/manifest.webmanifest">`,
    `<meta name="theme-color" content="${escAttr(settings.themeColor)}">`,
  ].join("\n");
}

/**
 * Service-worker registration/update-toast script, and (when enabled) the
 * install-UI script — appended near the end of the body, like the analytics
 * body script, so neither blocks rendering.
 *
 * Both are external same-origin files, never inline `<script>` blocks: the
 * default CSP is `script-src 'self'` with no `'unsafe-inline'` (see
 * `security-headers.ts`), which silently drops inline scripts — the same
 * reason `google-tag.ts` computes hashes instead of relaxing the policy.
 * `pwa-install.js`'s per-site config travels as `data-*` attributes on its
 * own `<script>` tag instead, which `script-src` has no say over at all.
 */
export function buildPwaBodyHtml(settings: PwaSettings): string {
  if (!settings.enabled) return "";
  const parts: string[] = [`<script src="/js/pwa-register.js" defer></script>`];
  if (settings.installUi.enabled) {
    parts.push(
      `<script src="/js/pwa-install.js" defer` +
        ` data-label="${escAttr(settings.installUi.label)}"` +
        ` data-description="${escAttr(settings.installUi.description)}"` +
        ` data-show-logo="${settings.installUi.showLogo ? "1" : "0"}"></script>`,
    );
  }
  return parts.join("\n");
}
