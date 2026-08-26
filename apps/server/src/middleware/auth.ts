import type { NextFunction, Request, Response } from "express";
import { resolveSession } from "../lib/auth-session.js";
import { syncCsrfCookie, type SessionPayload } from "../lib/session.js";

declare global {
  namespace Express {
    interface Request {
      session?: SessionPayload;
    }
  }
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  resolveSession(req, res)
    .then((session) => {
      if (!session) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      // Every authenticated request re-syncs, so a cookie that has drifted out
      // of step is corrected rather than leaving the account unable to write.
      syncCsrfCookie(req, res, session);
      req.session = session;
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
        syncCsrfCookie(req, res, session);
        req.session = session;
        next();
      })
      .catch(next);
  };
}

export function optionalSession(req: Request, res: Response, next: NextFunction): void {
  resolveSession(req, res)
    .then((session) => {
      if (session) {
        syncCsrfCookie(req, res, session);
        req.session = session;
      }
      next();
    })
    .catch(next);
}
