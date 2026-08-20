import fs from "node:fs";
import type { NextFunction, Request, Response } from "express";
import { envFilePath } from "../lib/jf-root.js";

export function isInstalled(): boolean {
  if (process.env.STATE === "INSTALLED") return true;
  try {
    const contents = fs.readFileSync(envFilePath(), "utf-8");
    const installed = contents.split("\n").some((line) => line.trim() === "STATE=INSTALLED");
    if (installed) process.env.STATE = "INSTALLED";
    return installed;
  } catch {
    return false;
  }
}

/** Redirect public routes to /install when not yet installed. */
export function requireInstalled(req: Request, res: Response, next: NextFunction): void {
  if (isInstalled()) {
    next();
    return;
  }
  if (req.path.startsWith("/api/install") || req.path.startsWith("/api/i18n") || req.path === "/install" || req.path.startsWith("/admin-ui")) {
    next();
    return;
  }
  if (req.path.startsWith("/api/")) {
    res.status(503).json({ error: "Not installed" });
    return;
  }
  res.redirect("/install");
}

/** Block install routes once installed. */
export function blockIfInstalled(req: Request, res: Response, next: NextFunction): void {
  if (!isInstalled()) {
    next();
    return;
  }
  if (req.path === "/install" || req.path.startsWith("/api/install")) {
    res.redirect("/admin");
    return;
  }
  next();
}
