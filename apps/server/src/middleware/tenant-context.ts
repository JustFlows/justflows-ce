// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from "express";
import { getDb, runWithDatabase } from "../lib/database/db.js";
import { isInstalled } from "./install-guard.js";
import { getTenantContext, loopbackPort, runWithTenant, type TenantRequestContext } from "../lib/tenancy/context.js";
import { borrowSeparateDatabase, separateDatabaseForSite } from "../lib/tenancy/connections.js";
import { effectiveDatabaseMode } from "../lib/tenancy/choice.js";
import { installationRootHostRecord, resolveHost } from "../lib/tenancy/registry.js";
import { primaryRedirectHost, type HostRecord } from "../lib/tenancy/host.js";
import { STATIC_EXPORT_HEADER } from "../lib/static-export/config.js";
import { multisiteEnabled } from "../lib/tenancy/multisite.js";

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

function sendUnavailable(res: Response): void {
  res.status(503).set("Retry-After", "5").type("text/plain").send("This site is temporarily unavailable");
}

async function bindTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  const decision = await resolveHost(req.hostname);
  if (decision.kind === "unavailable") {
    sendUnavailable(res);
    return;
  }
  if (decision.kind === "unconfigured") {
    next();
    return;
  }
  if (decision.kind === "unknown") {
    if (multisiteEnabled() && (req.method === "GET" || req.method === "HEAD")) {
      const root = await installationRootHostRecord();
      if (root) {
        if (isUnknownHostPublicAsset(req.path)) {
          await withUnknownHostRoot(req, res, root, () => next());
          return;
        }
        if (req.accepts("html")) {
          await withUnknownHostRoot(req, res, root, async () => {
            const { renderMultisiteNotFoundPage } = await import("../routes/public/public-site.js");
            await renderMultisiteNotFoundPage(req, res);
          });
          return;
        }
      }
    }
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
    devPort: loopbackPort(record.hostname, req.headers.host),
    userMode: record.userMode,
    databaseMode: record.databaseMode,
    rootSite: record.rootSite === true,
    activePluginIds: null,
  };
  const needsSeparate = effectiveDatabaseMode(record.databaseMode, record.databaseChoice) === "separate";
  let client = null;
  try {
    const separate = await separateDatabaseForSite(
      record.tenantId,
      record.siteId,
      record.databaseChoice,
      record.databaseMode,
    );
    client = separate ? await borrowSeparateDatabase(separate) : null;
  } catch {
    client = null;
  }
  // A site that lives in its own database must never fall through to the
  // installation database.
  if (needsSeparate && !client) {
    sendUnavailable(res);
    return;
  }
  const start = () => {
    void loadPluginAllowlist(context).then((loaded) => {
      // Plugin hooks and routes are gated on this list; without it the
      // request cannot be served safely.
      if (!loaded) {
        sendUnavailable(res);
        return;
      }
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

/** Public files needed by a selected themed fallback page; admin, API, auth, and extension routes stay unreachable. */
export function isUnknownHostPublicAsset(pathname: string): boolean {
  if (pathname === "/theme.css" || pathname === "/theme.js" || pathname === "/favicon.ico") return true;
  if (/^\/jf-plugins\.[0-9a-f]{6,40}\.(?:js|css)$/.test(pathname)) return true;
  return /^\/(?:js|assets|css-providers|theme-assets|uploads|public)(?:\/|$)/.test(pathname);
}

async function withUnknownHostRoot(
  req: Request,
  res: Response,
  record: HostRecord,
  action: () => void | Promise<void>,
): Promise<void> {
  const hostname = record.primaryHostname ?? record.hostname;
  const context: TenantRequestContext = {
    tenantId: record.tenantId,
    siteId: record.siteId,
    hostname,
    devPort: loopbackPort(hostname, req.headers.host),
    userMode: record.userMode,
    databaseMode: record.databaseMode,
    rootSite: true,
    activePluginIds: null,
  };
  const needsSeparate = effectiveDatabaseMode(record.databaseMode, record.databaseChoice) === "separate";
  let client = null;
  try {
    const separate = await separateDatabaseForSite(
      record.tenantId,
      record.siteId,
      record.databaseChoice,
      record.databaseMode,
    );
    client = separate ? await borrowSeparateDatabase(separate) : null;
  } catch {
    client = null;
  }
  if (needsSeparate && !client) {
    sendUnavailable(res);
    return;
  }
  const run = async () => {
    if (!(await loadPluginAllowlist(context))) {
      sendUnavailable(res);
      return;
    }
    await runWithTenant(context, action);
  };
  if (client) await runWithDatabase(client, run);
  else await run();
}

/** A site whose primary address is a custom domain is served there. */
async function redirectToPrimary(req: Request, res: Response, record: HostRecord, viaLoopback: boolean): Promise<boolean> {
  if (!record.primaryCustom || !record.primaryHostname || record.primaryHostname === record.hostname) return false;
  const { cachedDomainSettings } = await import("../lib/domains/domain-settings.js");
  const settings = await cachedDomainSettings();
  if (!settings.enabled || !settings.redirectToPrimary) return false;
  const { getAdminPathConfig } = await import("../lib/admin/admin-path.js");
  const adminBase = (await getAdminPathConfig()).path;
  const host = primaryRedirectHost({
    record,
    viaLoopback,
    method: req.method,
    path: req.path,
    adminBase,
    staticExport: Boolean(req.get(STATIC_EXPORT_HEADER)),
    preview: req.query.preview === "1",
  });
  if (!host) return false;
  res.redirect(301, `https://${host}${req.originalUrl.startsWith("/") ? req.originalUrl : "/"}`);
  return true;
}

async function loadPluginAllowlist(context: TenantRequestContext): Promise<boolean> {
  try {
    const db = await getDb();
    const rows = await db.query<{ plugin_id: string }>(
      "SELECT plugin_id FROM plugins WHERE site_id = ? AND status = 'active'",
      [context.siteId],
    );
    context.activePluginIds = new Set(rows.map((row: { plugin_id: string }) => String(row.plugin_id)));
    if (context.rootSite) {
      context.networkPluginIds = context.activePluginIds;
    } else {
      const { activeMainSitePluginIds } = await import("../lib/plugins/plugin-network.js");
      context.networkPluginIds = await activeMainSitePluginIds();
    }
    return true;
  } catch {
    context.activePluginIds = null;
    return false;
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
  const current = getTenantContext();
  let requestSiteId = current?.siteId;
  if (!requestSiteId) {
    const decision = await resolveHost(req.hostname);
    if (decision.kind === "unavailable") {
      res.status(503).end();
      return;
    }
    if (decision.kind === "unconfigured") {
      next();
      return;
    }
    if (decision.kind !== "ready") {
      res.status(404).end();
      return;
    }
    requestSiteId = decision.record.siteId;
  }
  const relative = req.path.startsWith("/uploads/") ? req.path.slice("/uploads".length) : req.path;
  const { isPrivateUploadPath } = await import("../lib/media/upload-serve.js");
  const siteId = relative.split("/").filter(Boolean)[0];
  if (isPrivateUploadPath(relative) || siteId !== requestSiteId) {
    res.setHeader("Cache-Control", "private, no-store");
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
    if (decision.kind === "unavailable") {
      res.status(503).json({ error: "This site is temporarily unavailable" });
      return;
    }
    if (decision.kind === "ready" && presented !== decision.record.siteId) {
      res.status(403).json({ error: "Site does not match this host" });
      return;
    }
    next();
  }).catch(next);
}
