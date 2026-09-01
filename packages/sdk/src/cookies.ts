// SPDX-License-Identifier: MIT

import { z } from "zod";

/**
 * The consent categories every cookie a site sets must fall into. A plugin that
 * writes any non-essential cookie MUST declare it (`ctx.cookies.declare`) so the
 * consent banner can disclose it and expire it when its category is withdrawn.
 *
 * - `necessary`   — required for the site to work (auth, CSRF, load balancing,
 *                   the consent record itself). Cannot be declined.
 * - `preferences` — remembers non-essential choices (language, region, theme).
 *   Also known as "functional".
 * - `analytics`   — measures usage; aggregated, no ad targeting.
 * - `marketing`   — advertising, retargeting, cross-site measurement, social.
 */
export const COOKIE_CATEGORIES = ["necessary", "preferences", "analytics", "marketing"] as const;
export type CookieCategory = (typeof COOKIE_CATEGORIES)[number];

export const CookieDeclarationSchema = z.object({
  /** Exact cookie name, or a prefix ending in `*` (e.g. `_ga_*`). */
  name: z
    .string()
    .min(1)
    .max(128)
    .regex(
      /^[A-Za-z0-9_.*-]+$/,
      "Cookie name may only contain letters, digits, _ . - and a trailing *",
    ),
  category: z.enum(COOKIE_CATEGORIES),
  /** Why the cookie is set — shown verbatim in the consent disclosure. */
  purpose: z.string().min(1).max(300),
  /** Who sets it, when it is not first-party (e.g. "Google", "Meta"). */
  provider: z.string().max(128).optional(),
  /** Cookie domain, when it differs from the site host. */
  domain: z.string().max(253).optional(),
  /** Human-readable lifetime: `"session"`, `"13 months"`, `"1 year"`. */
  duration: z.string().max(64).optional(),
});

export type CookieDeclaration = z.infer<typeof CookieDeclarationSchema>;

/** A declaration after the host has attributed it and applied operator overrides. */
export interface ResolvedCookie extends CookieDeclaration {
  /** `"core"` or the id of the plugin that declared it. */
  declaredBy: string;
  /** `category`, unless the operator re-classified this cookie name. */
  effectiveCategory: CookieCategory;
  /** True when the operator overrode the declared category. */
  overridden: boolean;
}

export interface PluginCookiesApi {
  /**
   * Declare a cookie this plugin sets. Anything that is not strictly necessary
   * MUST be declared so the consent plugin can disclose and enforce it. Calling
   * again with the same `name` replaces the earlier declaration. All of a
   * plugin's declarations are dropped when it deactivates.
   */
  declare(cookie: CookieDeclaration | CookieDeclaration[]): void;

  /**
   * The whole site cookie registry — the host's own cookies plus every active
   * plugin's declarations — with the operator's category overrides applied.
   */
  list(): Promise<ResolvedCookie[]>;
}

/** Resolve raw declarations against operator overrides, de-duplicating by name
 * (host entries win over plugin entries for the same name). */
export function resolveCookies(
  declared: Array<CookieDeclaration & { declaredBy: string }>,
  overrides: Record<string, CookieCategory> = {},
): ResolvedCookie[] {
  const byName = new Map<string, CookieDeclaration & { declaredBy: string }>();
  for (const entry of declared) {
    const existing = byName.get(entry.name);
    if (!existing || (existing.declaredBy !== "core" && entry.declaredBy === "core")) {
      byName.set(entry.name, entry);
    }
  }
  return [...byName.values()]
    .map((entry) => {
      const override = overrides[entry.name];
      return {
        ...entry,
        effectiveCategory: override ?? entry.category,
        overridden: override !== undefined && override !== entry.category,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Match a stored cookie name against a declaration name that may end in `*`. */
export function cookieNameMatches(pattern: string, cookieName: string): boolean {
  if (pattern.endsWith("*")) return cookieName.startsWith(pattern.slice(0, -1));
  return pattern === cookieName;
}
