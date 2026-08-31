// SPDX-License-Identifier: MIT

import { esc } from "@justflows/blocks";
import type { CaptchaProvider } from "./comments-settings.js";

// ─── CAPTCHA providers ──────────────────────────────────────────────────────
//
// One provider configuration (dropdown + site key + secret + score threshold)
// lives in the site `comments` settings, surfaced under Settings → Discussion.
// Both the public comments form and the Forms plugin reuse it from here so the
// keys are entered once.

export interface CaptchaMeta {
  verifyUrl: string;
  /** Widget script the public form loads. */
  scriptSrc: string;
  /** Hosts to add to the public CSP when this provider is active. */
  csp: { script: string[]; frame: string[]; connect: string[] };
  /** Form field the provider's widget submits the solved token in. */
  field: string;
  widgetClass: string;
}

export const CAPTCHA_META: Record<Exclude<CaptchaProvider, "none">, CaptchaMeta> = {
  turnstile: {
    verifyUrl: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    scriptSrc: "https://challenges.cloudflare.com/turnstile/v0/api.js",
    csp: {
      script: ["https://challenges.cloudflare.com"],
      frame: ["https://challenges.cloudflare.com"],
      connect: ["https://challenges.cloudflare.com"],
    },
    field: "cf-turnstile-response",
    widgetClass: "cf-turnstile",
  },
  hcaptcha: {
    verifyUrl: "https://api.hcaptcha.com/siteverify",
    scriptSrc: "https://js.hcaptcha.com/1/api.js",
    csp: {
      script: ["https://hcaptcha.com", "https://*.hcaptcha.com"],
      frame: ["https://hcaptcha.com", "https://*.hcaptcha.com"],
      connect: ["https://hcaptcha.com", "https://*.hcaptcha.com"],
    },
    field: "h-captcha-response",
    widgetClass: "h-captcha",
  },
  recaptcha: {
    verifyUrl: "https://www.google.com/recaptcha/api/siteverify",
    scriptSrc: "https://www.google.com/recaptcha/api.js",
    csp: {
      script: ["https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/"],
      frame: ["https://www.google.com/recaptcha/", "https://recaptcha.google.com/recaptcha/"],
      connect: ["https://www.google.com/recaptcha/"],
    },
    field: "g-recaptcha-response",
    widgetClass: "g-recaptcha",
  },
  "recaptcha-v3": {
    verifyUrl: "https://www.google.com/recaptcha/api/siteverify",
    scriptSrc: "https://www.google.com/recaptcha/api.js",
    csp: {
      script: ["https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/"],
      frame: ["https://www.google.com/recaptcha/", "https://recaptcha.google.com/recaptcha/"],
      connect: ["https://www.google.com/recaptcha/"],
    },
    field: "g-recaptcha-response",
    widgetClass: "g-recaptcha-v3",
  },
};

export interface VerifyCaptchaOptions {
  /**
   * reCAPTCHA v3 only: the `action` the token must have been minted for, so a
   * token solved on another page (or another site's page) is rejected. Ignored
   * by the checkbox providers.
   */
  expectedAction: string;
  /** reCAPTCHA v3 only: minimum accepted score in [0, 1]. */
  scoreThreshold: number;
}

export async function verifyCaptcha(
  provider: Exclude<CaptchaProvider, "none">,
  secret: string,
  token: string,
  ip: string,
  opts: VerifyCaptchaOptions,
): Promise<boolean> {
  if (!secret || !token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const res = await fetch(CAPTCHA_META[provider].verifyUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean; action?: string; score?: number };
    if (data.success !== true) return false;
    if (provider !== "recaptcha-v3") return true;
    return (
      data.action === opts.expectedAction &&
      typeof data.score === "number" &&
      data.score >= opts.scoreThreshold
    );
  } catch (err) {
    console.error("[justflows] captcha verification failed:", err);
    return false;
  }
}

export interface CaptchaWidgetOptions {
  /** Extra class placed on the checkbox widget div, for form-specific styling. */
  widgetClass?: string;
  /** reCAPTCHA v3 only: the `action` string the widget mints its token for. */
  recaptchaV3Action: string;
}

export interface CaptchaWidgetHtml {
  /** Markup to drop into the `<form>` (widget div / hidden input + scripts). */
  widget: string;
  /**
   * Attributes for the `<form>` element itself. Non-empty only for reCAPTCHA v3,
   * which is driven by `/js/recaptcha-v3.js` reading them.
   */
  formAttributes: string;
}

/**
 * Build the client-side markup for a configured CAPTCHA provider. Shared by the
 * comments form and the Forms plugin so both render an identical widget.
 */
export function renderCaptchaWidget(
  provider: Exclude<CaptchaProvider, "none">,
  siteKey: string,
  opts: CaptchaWidgetOptions,
): CaptchaWidgetHtml {
  const meta = CAPTCHA_META[provider];
  if (provider === "recaptcha-v3") {
    return {
      widget: `<input type="hidden" name="${meta.field}" value="">
    <script src="${esc(meta.scriptSrc)}?render=${encodeURIComponent(siteKey)}" async defer></script>
    <script src="/js/recaptcha-v3.js" defer></script>`,
      formAttributes: ` data-jf-recaptcha-v3 data-sitekey="${esc(siteKey)}" data-action="${esc(
        opts.recaptchaV3Action,
      )}"`,
    };
  }
  const widgetClass = opts.widgetClass ? `${meta.widgetClass} ${opts.widgetClass}` : meta.widgetClass;
  return {
    widget: `<div class="${widgetClass}" data-sitekey="${esc(siteKey)}"></div>
    <script src="${esc(meta.scriptSrc)}" async defer></script>`,
    formAttributes: "",
  };
}
