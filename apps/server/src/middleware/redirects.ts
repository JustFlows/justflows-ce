// SPDX-License-Identifier: MIT
import type { Request, Response, NextFunction } from "express";
import { getSiteId } from "../lib/site-settings.js";
import { reservedPermalinkPath } from "../lib/permalinks-db.js";
import { runtimeRedirects, recordNotFound } from "../lib/redirects-db.js";
import { matchRedirect, resolveRedirect, safeRedirectTarget } from "../lib/redirects.js";

let pendingLogs = 0;
let logWarning = false;
export async function managedRedirects(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (
    !["GET", "HEAD"].includes(req.method) ||
    req.query.preview !== undefined ||
    !safeRedirectTarget(req.path)
  )
    return next();
  try {
    if (await reservedPermalinkPath(req.path)) return next();
    const siteId = await getSiteId();
    if (!siteId) return next();
    const { rules, canonicalize } = await runtimeRedirects(siteId);
    const incoming =
      req.path + (typeof req.query.p === "string" ? `?p=${encodeURIComponent(req.query.p)}` : "");
    const result = rules.some(
      (r) => !r.id.startsWith("history:") && matchRedirect(r, incoming) !== null,
    )
      ? resolveRedirect(rules, incoming, canonicalize)
      : null;
    if (result) {
      // Barrier for the Location header: request-derived capture groups may only
      // land in a target's path/query, so the emitted URL must be site-relative or
      // point at a host an operator explicitly configured on an external rule.
      const location = result.target;
      let allowed =
        location.startsWith("/") && !location.startsWith("//") && !location.includes("\\");
      if (!allowed) {
        try {
          const url = new URL(location);
          const externalHosts = new Set(
            rules.flatMap((r) => {
              if (!r.enabled || r.targetType !== "external") return [];
              try {
                return [new URL(r.target).host];
              } catch {
                return [];
              }
            }),
          );
          allowed =
            (url.protocol === "https:" || url.protocol === "http:") &&
            !url.username &&
            !url.password &&
            externalHosts.has(url.host);
        } catch {
          allowed = false;
        }
      }
      if (allowed) {
        res.setHeader("Cache-Control", "no-store");
        res.redirect(result.status, location);
        return;
      }
    }
    if (req.method === "GET")
      res.once("finish", () => {
        if (res.statusCode !== 404 || pendingLogs >= 32) return;
        pendingLogs++;
        void recordNotFound(siteId, req.path, req.get("referer") ?? "")
          .catch(() => {
            if (!logWarning) {
              logWarning = true;
              console.error("[justflows] 404 logging unavailable");
            }
          })
          .finally(() => {
            pendingLogs--;
          });
      });
    next();
  } catch (err) {
    next(err);
  }
}
