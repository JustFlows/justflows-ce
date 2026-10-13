// SPDX-License-Identifier: MIT

import { timingSafeEqual } from "node:crypto";
import { getAdminPathConfig } from "../admin/admin-path.js";

/**
 * Every auth flow — sign-in, forgot password, reset — exists twice: the site's
 * themed pages for members (`/login`, `/forgot-password`, …) and the admin's
 * own pages for staff under the configured admin path (`<path>/login`, …).
 * A request belongs to the admin surface only when it names that path, which
 * only the admin pages can do, as they read it from their own URL. Each flow
 * refuses the other surface's accounts with the answer it gives an unknown
 * account, so neither surface reveals who is staff or where the admin lives.
 */
export type AuthSurface = "admin" | "site";

export function knowsAdminPath(supplied: unknown, configured: string): boolean {
  if (typeof supplied !== "string") return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(configured);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function requestSurface(suppliedAdminPath: unknown): Promise<AuthSurface> {
  return knowsAdminPath(suppliedAdminPath, (await getAdminPathConfig()).path) ? "admin" : "site";
}

/**
 * Where the browser should go once authenticated.
 *
 * A subscriber, or a plugin role such as Shop's customer, has nothing in the
 * admin app and lands on the site's frontend account page.
 * Everyone else lands on the admin app — at whatever path the administrator
 * moved it to (issue #51). The pre-session pages have no way to know that path
 * on their own, and it should not be handed to anyone who has not signed in,
 * so it is resolved here and returned in the response.
 */
export async function postAuthRedirect(role: string, userId?: string, siteId?: string): Promise<string> {
  if (userId && siteId) {
    const { installationRootSiteId } = await import("../tenancy/registry.js");
    if (await installationRootSiteId() === siteId) {
      const { getControlDb } = await import("../database/db.js");
      const owners = await (await getControlDb()).query("SELECT id FROM tenants WHERE owner_user_id = ? AND status <> 'deleted' LIMIT 1", [userId]);
      if (owners.length) return (await import("../account/pages.js")).accountHomeUrl(siteId);
    }
    const { getEffectiveAccess } = await import("./access-policy.js");
    const access = await getEffectiveAccess(userId, siteId, role);
    if (!access.capabilities.some((capability) => capability !== "content:read")) return (await import("../account/pages.js")).accountHomeUrl(siteId);
  } else if (role === "subscriber" || role === "customer") return "/account";
  return (await getAdminPathConfig()).path;
}

/** Whether this account belongs on the admin surface (it lands in the admin app). */
export async function isStaffAccount(role: string, userId: string, siteId: string): Promise<boolean> {
  return (await postAuthRedirect(role, userId, siteId)) === (await getAdminPathConfig()).path;
}

/** The surface an account's own auth pages live on. */
export async function accountSurface(role: string, userId: string, siteId: string): Promise<AuthSurface> {
  return (await isStaffAccount(role, userId, siteId)) ? "admin" : "site";
}

/** The page a surface's flow lives on, e.g. `authPagePath("admin", "reset-password")`. */
export async function authPagePath(surface: AuthSurface, page: "login" | "forgot-password" | "reset-password"): Promise<string> {
  return surface === "admin" ? `${(await getAdminPathConfig()).path}/${page}` : `/${page}`;
}
