// SPDX-License-Identifier: MIT

import {
  COOKIE_CATEGORIES,
  resolveCookies,
  type CookieCategory,
  type CookieDeclaration,
  type ResolvedCookie,
} from "@justflows/sdk";
import { getSiteSetting, setSiteSetting } from "../settings/site-settings.js";
import { getPluginLoader } from "../plugins/plugin-runtime.js";

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
 * Every cookie the host itself sets. Cookies a plugin's markup causes (a
 * measurement tag, an embed) are declared by that plugin.
 */
export async function getCoreCookies(): Promise<CookieDeclaration[]> {
  return [...CORE_COOKIES];
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
