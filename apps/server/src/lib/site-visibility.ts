import type { Request, Response } from "express";
import { resolveSession } from "./auth-session.js";
import { getSiteId, getSiteSetting } from "./site-settings.js";

const BYPASS_ROLES = new Set(["administrator", "editor"]);

export async function isSitePublic(): Promise<boolean> {
  const siteId = await getSiteId();
  if (!siteId) return false;
  const value = await getSiteSetting<boolean>(siteId, "site_public");
  if (value === null || value === undefined) return true;
  return value === true;
}

export async function shouldDiscourageSearchEngines(): Promise<boolean> {
  const siteId = await getSiteId();
  if (!siteId) return true;
  const value = await getSiteSetting<boolean>(siteId, "discourage_search_engines");
  return value === true;
}

/** Logged-in administrators and editors can browse an unpublished site. */
export async function canViewUnpublishedSite(req: Request, res: Response): Promise<boolean> {
  const session = await resolveSession(req, res);
  return session !== null && BYPASS_ROLES.has(session.role);
}
