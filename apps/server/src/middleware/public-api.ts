import type { NextFunction, Request, Response } from "express";
import { canUsePublicApiWhileOff, isPublicApiEnabled } from "../lib/public-api-access.js";

/**
 * Guards every public-facing API route. When Admin → Settings → Public API is
 * switched off the whole surface answers 404 for anonymous callers, exactly as
 * if it were never mounted. Administrators and editors keep working.
 */
export function publicApiGuard(req: Request, res: Response, next: NextFunction): void {
  isPublicApiEnabled()
    .then(async (enabled) => {
      if (enabled) {
        next();
        return;
      }
      if (await canUsePublicApiWhileOff(req, res)) {
        next();
        return;
      }
      res.status(404).json({ error: "Not found" });
    })
    .catch(next);
}
