// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from "express";
import { getDb, runWithDatabase } from "../lib/database/db.js";
import { isInstalled } from "./install-guard.js";
import { runWithTenant, type TenantRequestContext } from "../lib/tenancy/context.js";
import { borrowSeparateDatabase, separateDatabaseForSite } from "../lib/tenancy/connections.js";
import { resolveHost } from "../lib/tenancy/registry.js";
import { primaryRedirectHost, type HostRecord } from "../lib/tenancy/host.js";

const SKIP = new Set(["/api/healthz", "/api/install", "/api/i18n", "/api/domains/tls-allowed"]);

function skipped(path: string): boolean {
  if (SKIP.has(path)) return true;
  return path.startsWith("/api/install") || path.startsWith("/api/i18n/");
}

export function tenantContext(req: Request, res: Response, next: NextFunction): void {
  if (!isInstalled() || skipped(req.path)) {
    next();
    return;
  }
  void bindTenant(req, res, next).catch(next);
}

async function bindTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  const decision = await resolveHost(req.hostname);
  if (decision.kind === "unconfigured") {
    next();
    return;
  }
  if (decision.kind === "unknown") {
    res.status(404).type("text/plain").send("Site not found");
    return;
  }
  if (decision.kind === "suspended") {
    res.status(403).type("text/plain").send("This site is suspended");
    return;
  }
  if (decision.kind === "provisioning") {
    res.status(503).type("text/plain").send("This site is not ready");
    return;
  }

  const record = decision.record;
  const context: TenantRequestContext = {
    tenantId: record.tenantId,
    siteId: record.siteId,
    hostname: record.hostname,
    userMode: record.userMode,
    databaseMode: record.databaseMode,
    rootSite: record.rootSite === true,
    activePluginIds: null,
  };
  const separate = await separateDatabaseForSite(
    record.tenantId,
    record.siteId,
    record.databaseChoice,
    record.databaseMode,
  );
  const client = separate ? await borrowSeparateDatabase(separate) : null;
  const start = () => {
    void loadPluginAllowlist(context).finally(() => {
      runWithTenant(context, () => {
        void redirectToPrimary(req, res, record, decision.viaLoopback).then(
          (sent) => {
            if (!sent) next();
          },
          () => next(),
        );
      });
    });
  };
  if (client) {
    runWithDatabase(client, start);
    return;
  }
  start();
}

/** A site whose primary address is a custom domain is served there. */
async function redirectToPrimary(req: Request, res: Response, record: HostRecord, viaLoopback: boolean): Promise<boolean> {
  if (!record.primaryCustom || !record.primaryHostname || record.primaryHostname === record.hostname) return false;
  const { cachedDomainSettings } = await import("../lib/domains/domain-settings.js");
  const settings = await cachedDomainSettings();
  if (!settings.enabled || !settings.redirectToPrimary) return false;
  const { getAdminPathConfig } = await import("../lib/admin/admin-path.js");
  const adminBase = (await getAdminPathConfig()).path;
  const host = primaryRedirectHost({ record, viaLoopback, method: req.method, path: req.path, adminBase });
  if (!host) return false;
  res.redirect(301, `https://${host}${req.originalUrl.startsWith("/") ? req.originalUrl : "/"}`);
  return true;
}

async function loadPluginAllowlist(context: TenantRequestContext): Promise<void> {
  try {
    const db = await getDb();
    const rows = await db.query<{ plugin_id: string }>(
      "SELECT plugin_id FROM plugins WHERE site_id = ? AND status = 'active'",
      [context.siteId],
    );
    context.activePluginIds = new Set(rows.map((row: { plugin_id: string }) => String(row.plugin_id)));
  } catch {
    context.activePluginIds = null;
  }
}

export function uploadsSiteGuard(req: Request, res: Response, next: NextFunction): void {
  void guardUploads(req, res, next).catch(next);
}

async function guardUploads(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!isInstalled()) {
    next();
    return;
  }
  const decision = await resolveHost(req.hostname);
  if (decision.kind === "unconfigured") {
    next();
    return;
  }
  if (decision.kind !== "ready") {
    res.status(404).end();
    return;
  }
  const relative = req.path.startsWith("/uploads/") ? req.path.slice("/uploads".length) : req.path;
  const siteId = relative.split("/").filter(Boolean)[0];
  if (siteId !== decision.record.siteId) {
    res.status(404).end();
    return;
  }
  next();
}

export function rejectForeignSiteId(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith("/api/platform") || req.path.startsWith("/api/signup")) {
    next();
    return;
  }
  const claimed = typeof req.query.siteId === "string" ? req.query.siteId : undefined;
  const bodySite = req.body && typeof req.body === "object" ? (req.body as { siteId?: unknown }).siteId : undefined;
  const presented = claimed ?? (typeof bodySite === "string" ? bodySite : undefined);
  if (!presented) {
    next();
    return;
  }
  void resolveHost(req.hostname).then((decision) => {
    if (decision.kind === "ready" && presented !== decision.record.siteId) {
      res.status(403).json({ error: "Site does not match this host" });
      return;
    }
    next();
  }).catch(next);
}
