// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from "express";
import { requestSurface } from "../lib/auth/auth-surface.js";

/**
 * While the site is offline or in maintenance, only the staff surface may sign
 * in, request or redeem a reset: a request that names the admin path passes,
 * every member request gets the same 503 before any account is looked up, so
 * the answer reveals nothing about who exists. Mirrors the page gate on the
 * member auth pages (server.ts).
 */
export async function closedToMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const adminPath = (req.body as { adminPath?: unknown } | undefined)?.adminPath;
    if ((await requestSurface(adminPath)) === "admin") { next(); return; }
    const { canViewUnpublishedSite, isSiteClosed } = await import("../lib/settings/site-visibility.js");
    if (!(await isSiteClosed()) || (await canViewUnpublishedSite(req, res))) { next(); return; }
    res.setHeader("Cache-Control", "private, no-store");
    res.status(503).json({ error: "This site is not available right now. Please try again later." });
  } catch (err) {
    next(err);
  }
}
