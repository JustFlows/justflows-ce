import type { Request, Response } from "express";
import { resolveSession } from "../auth/auth-session.js";
import { getSiteId, getSiteSetting } from "./site-settings.js";

const BYPASS_ROLES = new Set(["administrator", "editor"]);

export async function isSitePublic(): Promise<boolean> {
  const siteId = await getSiteId();
  if (!siteId) return false;
  const value = await getSiteSetting<boolean>(siteId, "site_public");
  return value === true;
}

export async function shouldDiscourageSearchEngines(): Promise<boolean> {
  const siteId = await getSiteId();
  if (!siteId) return true;
  const value = await getSiteSetting<boolean>(siteId, "discourage_search_engines");
  if (value === null || value === undefined) return true;
  return value === true;
}

/** Logged-in administrators and editors can browse an unpublished site. */
export async function canViewUnpublishedSite(req: Request, res: Response): Promise<boolean> {
  const session = await resolveSession(req, res);
  return session !== null && BYPASS_ROLES.has(session.role);
}

/**
 * Whether the site is closed to visitors: in maintenance mode, or not yet
 * public. While it is, only the staff surface stays open — the admin and its
 * own sign-in pages — so the site's member sign-in, registration, password and
 * account pages, and the member side of the auth API, are closed as well.
 * A read failure counts as open, as it does for the maintenance gate.
 */
export async function isSiteClosed(): Promise<boolean> {
  try {
    const siteId = await getSiteId();
    if (!siteId) return false;
    const { getErrorPageConfig } = await import("../rendering/error-pages.js");
    if ((await getErrorPageConfig(siteId)).maintenance?.enabled) return true;
    return !(await isSitePublic());
  } catch {
    return false;
  }
}
