import type { NextFunction, Request, Response } from "express";
import { getSession } from "../lib/session.js";
import { ROLES } from "../lib/rbac.js";

/**
 * Gate for the /admin surface: a session is required, and a subscriber — who
 * has no admin capability at all, every admin route requires at least
 * contributor — is sent to the site instead of an empty dashboard full of
 * 403s.
 *
 * This is UX only, not the security boundary: every admin API route still
 * enforces its own role independently via `requireRole`, regardless of
 * whether a browser ever reaches this gate.
 */
export function adminAccessGate(req: Request, res: Response, next: NextFunction): void {
  // Static assets under /admin (JS, CSS, images) are not pages — never bounce
  // those, or the app shell itself fails to load.
  if (req.path.match(/\.\w+$/)) {
    next();
    return;
  }

  const session = getSession(req);
  if (!session) {
    res.redirect("/login");
    return;
  }
  if (session.role === ROLES.SUBSCRIBER) {
    res.redirect("/");
    return;
  }
  next();
}
