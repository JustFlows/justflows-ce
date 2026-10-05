import type { NextFunction, Request, Response } from "express";
import { resolveSession } from "../lib/auth/auth-session.js";
import { syncCsrfCookie, type SessionPayload } from "../lib/auth/session.js";
import { userCan } from "../lib/auth/access-policy.js";
import { isInstallationRootRequest, sessionMatchesRequestSite } from "../lib/tenancy/access.js";
import type { AccessResource, UserCapability } from "@justflows/sdk";

declare global {
  namespace Express {
    interface Request {
      session?: SessionPayload;
    }
  }
}

function bindSession(req: Request, res: Response, session: SessionPayload): boolean {
  syncCsrfCookie(req, res, session);
  if (!sessionMatchesRequestSite(session.siteId)) {
    res.status(403).json({ error: "This session is not for this site" });
    return false;
  }
  req.session = session;
  return true;
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  resolveSession(req, res)
    .then((session) => {
      if (!session) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      if (!bindSession(req, res, session)) return;
      next();
    })
    .catch(next);
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    resolveSession(req, res)
      .then((session) => {
        if (!session) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
        if (!roles.includes(session.role)) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }
        if (!bindSession(req, res, session)) return;
        next();
      })
      .catch(next);
  };
}

/** Capability-first authorization for new and migrated routes. */
export function requireCapability(
  capability: UserCapability,
  resource?: (req: Request) => AccessResource,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    resolveSession(req, res)
      .then(async (session) => {
        if (!session) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
        if (!sessionMatchesRequestSite(session.siteId)) {
          res.status(403).json({ error: "This session is not for this site" });
          return;
        }
        if (!(await userCan(session, capability, resource?.(req) ?? {}))) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }
        syncCsrfCookie(req, res, session);
        req.session = session;
        next();
      })
      .catch(next);
  };
}

/** Core updates, diagnostics, and process settings. Site administrators do not get these. */
export function requireInstallationRoot(req: Request, res: Response, next: NextFunction): void {
  if (!req.session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!isInstallationRootRequest()) {
    res.status(403).json({ error: "This is managed on the main site." });
    return;
  }
  next();
}

export function optionalSession(req: Request, res: Response, next: NextFunction): void {
  resolveSession(req, res)
    .then((session) => {
      if (session && sessionMatchesRequestSite(session.siteId)) {
        syncCsrfCookie(req, res, session);
        req.session = session;
      }
      next();
    })
    .catch(next);
}
