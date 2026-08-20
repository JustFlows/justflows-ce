import type { Request, Response } from "express";
import { resolveSession } from "./auth-session.js";
import { getSiteId, getSiteSetting } from "./site-settings.js";

const BYPASS_ROLES = new Set(["administrator", "editor"]);

/**
 * Whether the public-facing API is exposed to anonymous visitors.
 *
 * Only covers routes that exist for the outside world (/api/v1/*, /api/site/*).
 * Internal admin routes (/api/content, /api/settings, …) are session-protected
 * and never affected by this switch.
 */
export async function isPublicApiEnabled(): Promise<boolean> {
  try {
    const siteId = await getSiteId();
    if (!siteId) return false;
    const value = await getSiteSetting<boolean>(siteId, "public_api_enabled");
    if (value === null || value === undefined) return false;
    return value === true;
  } catch {
    // Fail closed: never expose the public API when the setting cannot be read.
    return false;
  }
}

/** Logged-in administrators and editors keep their access while the public API is off. */
export async function canUsePublicApiWhileOff(req: Request, res: Response): Promise<boolean> {
  const session = await resolveSession(req, res);
  return session !== null && BYPASS_ROLES.has(session.role);
}
