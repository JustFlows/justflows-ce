// SPDX-License-Identifier: MIT

import {
  COOKIE_CATEGORIES,
  resolveCookies,
  type CookieCategory,
  type CookieDeclaration,
  type ResolvedCookie,
} from "@justflows/sdk";
import { getSiteSetting, setSiteSetting } from "./site-settings.js";
import { getPluginLoader } from "./plugin-runtime.js";

const OVERRIDES_KEY = "cookies.overrides";

/**
 * Cookies the platform itself sets. Plugins declare their own through
 * `ctx.cookies.declare`; the consent plugin discloses and enforces the union.
 */
export const CORE_COOKIES: CookieDeclaration[] = [
  {
    name: "jf_session",
    category: "necessary",
    purpose: "Keeps an administrator or member signed in.",
    duration: "session",
  },
  {
    name: "jf_csrf",
    category: "necessary",
    purpose: "Protects form submissions and admin actions against cross-site request forgery.",
    duration: "session",
  },
  {
    name: "jf_locale",
    category: "preferences",
    purpose: "Remembers the language a visitor chose.",
    duration: "1 year",
  },
];

/**
 * Cookies the Google tag (gtag.js / GA4 / Google Ads) drops from its own
 * client-side script. The host injects that tag natively when a tag ID is
 * configured in the Analytics plugin — so the host, not the plugin, declares
 * the cookies it causes. The consent plugin gates the tag behind the analytics
 * category and expires these when it is withdrawn.
 */
export function googleTagCookies(tagId: string): CookieDeclaration[] {
  const id = tagId.toUpperCase();
  const analytics: CookieDeclaration[] = [
    {
      name: "_ga",
      category: "analytics",
      provider: "Google",
      purpose: "Google Analytics — distinguishes visitors.",
      duration: "2 years",
    },
    {
      name: "_ga_*",
      category: "analytics",
      provider: "Google",
      purpose: "Google Analytics — persists session state.",
      duration: "2 years",
    },
    {
      name: "_gid",
      category: "analytics",
      provider: "Google",
      purpose: "Google Analytics — distinguishes visitors.",
      duration: "24 hours",
    },
    {
      name: "_gat_*",
      category: "analytics",
      provider: "Google",
      purpose: "Google Analytics — throttles the request rate.",
      duration: "1 minute",
    },
  ];
  // Google Ads / DoubleClick conversion linker.
  if (id.startsWith("AW-") || id.startsWith("DC-") || id.startsWith("GTM-")) {
    analytics.push({
      name: "_gcl_au",
      category: "marketing",
      provider: "Google",
      purpose: "Google Ads — stores and tracks ad-conversion attribution.",
      duration: "3 months",
    });
  }
  return analytics;
}

/** Every cookie the host itself is responsible for, given the live config. */
export async function getCoreCookies(): Promise<CookieDeclaration[]> {
  const cookies = [...CORE_COOKIES];
  try {
    const { getConfiguredGoogleTagId } = await import("./analytics-public.js");
    const tagId = await getConfiguredGoogleTagId();
    if (tagId) cookies.push(...googleTagCookies(tagId));
  } catch {
    /* analytics module unavailable — core cookies only */
  }
  return cookies;
}

export async function getCookieOverrides(siteId: string): Promise<Record<string, CookieCategory>> {
  const raw = await getSiteSetting<Record<string, unknown>>(siteId, OVERRIDES_KEY);
  const out: Record<string, CookieCategory> = {};
  if (raw && typeof raw === "object") {
    for (const [name, value] of Object.entries(raw)) {
      if ((COOKIE_CATEGORIES as readonly string[]).includes(String(value))) {
        out[name.slice(0, 128)] = value as CookieCategory;
      }
    }
  }
  return out;
}

export async function setCookieOverrides(
  siteId: string,
  overrides: Record<string, unknown>,
): Promise<Record<string, CookieCategory>> {
  const clean: Record<string, CookieCategory> = {};
  for (const [name, value] of Object.entries(overrides ?? {}).slice(0, 200)) {
    if ((COOKIE_CATEGORIES as readonly string[]).includes(String(value))) {
      clean[name.slice(0, 128)] = value as CookieCategory;
    }
  }
  await setSiteSetting(siteId, OVERRIDES_KEY, clean);
  return clean;
}

/** The full resolved registry for the admin API: core + every active plugin. */
export async function getResolvedCookieRegistry(siteId: string): Promise<ResolvedCookie[]> {
  const loader = getPluginLoader();
  const declared = [
    ...(await getCoreCookies()).map((c) => ({ ...c, declaredBy: "core" })),
    ...(loader?.cookieRegistry.all() ?? []),
  ];
  return resolveCookies(declared, await getCookieOverrides(siteId));
}
