// SPDX-License-Identifier: MIT

import { CAPTCHA_META } from "./captcha.js";
import { getCommentSettings, type CaptchaProvider } from "./comments-settings.js";

// The security-headers middleware runs on every public request, so the provider
// lookup is cached for a couple of seconds like the Google Tag id is.
//
// The provider is read from the `comments` settings, but it is shared: the Forms
// plugin reuses the same provider + keys. Widening the CSP whenever a provider is
// selected (regardless of which feature turns it on) therefore covers both.
let providerCache: { at: number; value: Promise<CaptchaProvider> } | null = null;

export async function getCaptchaProviderForCsp(): Promise<CaptchaProvider> {
  const now = Date.now();
  if (providerCache && now - providerCache.at < 2000) return providerCache.value;
  providerCache = {
    at: now,
    value: getCommentSettings()
      .then((s) => s.captchaProvider)
      .catch(() => "none" as CaptchaProvider),
  };
  return providerCache.value;
}

/**
 * Widen the public Content-Security-Policy so a configured CAPTCHA widget can
 * load its script and iframe. Mirrors withGoogleTagCsp: parse the header,
 * merge host sources into the relevant directives, keep directive order.
 * The provider scripts are external `<script src>` (not inline), so no hashes
 * are needed.
 */
export function withCaptchaCsp(csp: string, provider: CaptchaProvider): string {
  if (provider === "none") return csp;
  const meta = CAPTCHA_META[provider];
  const additions: Record<string, string[]> = {
    "script-src": meta.csp.script,
    "frame-src": meta.csp.frame,
    "connect-src": meta.csp.connect,
  };

  const parts = csp.split(";").map((p) => p.trim()).filter(Boolean);
  const order: string[] = [];
  const byName = new Map<string, string[]>();
  for (const part of parts) {
    const [name, ...rest] = part.split(/\s+/);
    if (!name) continue;
    const key = name.toLowerCase();
    if (!byName.has(key)) order.push(key);
    byName.set(key, [...(byName.get(key) ?? []), ...rest]);
  }

  for (const [directive, sources] of Object.entries(additions)) {
    const existing = byName.get(directive);
    if (!existing) {
      order.push(directive);
      byName.set(directive, ["'self'", ...sources]);
      continue;
    }
    const next = new Set(existing);
    for (const source of sources) next.add(source);
    byName.set(directive, [...next]);
  }

  return order.map((directive) => [directive, ...(byName.get(directive) ?? [])].join(" ")).join("; ");
}
