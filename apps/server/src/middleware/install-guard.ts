import fs from "node:fs";
import type { NextFunction, Request, Response } from "express";
import { envFilePath } from "../lib/jf-root.js";

/**
 * Set once a database probe has confirmed a site row exists. Install state was
 * derived only from a line in .env, so a container that lost that file reopened
 * the install wizard on a live database — letting anyone who reached it first
 * take the site over.
 */
let confirmedBySchema = false;

export function isInstalled(): boolean {
  if (confirmedBySchema) return true;
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

/**
 * Confirm install state against the database rather than the filesystem. Async,
 * so it cannot be part of isInstalled(); call it at boot and let the result
 * latch. A connection failure leaves the flag untouched — this can only ever
 * add certainty, never remove it.
 */
export async function confirmInstalledFromDatabase(): Promise<void> {
  if (confirmedBySchema || !process.env.DB_DRIVER) return;
  try {
    const { getDb } = await import("../lib/db.js");
    const db = await getDb();
    const rows = await db.query<{ id: string }>("SELECT id FROM sites LIMIT 1");
    if (rows[0]?.id) {
      confirmedBySchema = true;
      process.env.STATE = "INSTALLED";
      console.warn(
        "[justflows] Found an existing site in the database. Treating this instance as installed.",
      );
    }
  } catch {
    // No database yet, or no sites table — a genuinely fresh install.
  }
}

/** Reset between tests. */
export function resetInstallConfirmation(): void {
  confirmedBySchema = false;
}

/** Redirect public routes to /install when not yet installed. */
export function requireInstalled(req: Request, res: Response, next: NextFunction): void {
  if (isInstalled()) {
    next();
    return;
  }
  if (req.path.startsWith("/api/install") || req.path.startsWith("/api/bootstrap") || req.path.startsWith("/api/i18n") || req.path === "/install" || req.path.startsWith("/admin-ui")) {
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
