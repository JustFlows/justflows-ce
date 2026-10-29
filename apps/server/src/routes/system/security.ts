// SPDX-License-Identifier: MIT

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireRole } from "../../middleware/auth.js";
import { auditConfig } from "../../lib/security/security-audit.js";
import { loadSecurityCenter } from "../../lib/security/security-center-load.js";
import { loadWebServerGuide } from "../../lib/security/web-server-guide.js";
import { loadIntegrityOverview } from "../../lib/security/extension-integrity.js";
import { isInstallationRootRequest } from "../../lib/tenancy/access.js";
import { auditFromRequest } from "../../lib/security/audit-log.js";
import {
  SECURITY_HEADER_DEFS,
  defaultConfig,
  getSecurityHeadersConfig,
  normalizeConfig,
  recommendedConfig,
  resolveHeaders,
  saveSecurityHeadersConfig,
  SecurityHeadersConfigSchema,
  type SecurityHeadersConfig,
} from "../../lib/security/security-headers.js";
import { sendServerError } from "../../lib/http/send-error.js";
import { getAdminPathConfig, saveAdminPathConfig, validateAdminPath } from "../../lib/admin/admin-path.js";
import { requireSiteFeature } from "../../lib/tenancy/site-features.js";

const router = Router();

/** Security configuration is an administrator-only surface, read included. */
const adminOnly = requireRole("administrator");

/** Hashing installed trees is filesystem work, so the scan has its own budget. */
const integrityRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  identifier: "integrity",
});

router.use((req, res, next) => {
  const feature = req.path === "/headers" || req.path.startsWith("/headers/")
    ? "feature.securityHeaders"
    : req.path === "/admin-path" || req.path.startsWith("/admin-path/")
      ? "feature.securityAdminPath"
      : null;
  if (!feature) {
    next();
    return;
  }
  requireSiteFeature(feature)(req, res, next);
});

router.get("/center", adminOnly, async (_req, res) => {
  try {
    res.json(await loadSecurityCenter());
  } catch (e) {
    sendServerError(res, "security", e);
  }
});

router.get("/web-server", adminOnly, async (_req, res) => {
  try {
    res.json(await loadWebServerGuide());
  } catch (e) {
    sendServerError(res, "security", e);
  }
});

router.get("/integrity", adminOnly, integrityRateLimit, async (_req, res) => {
  if (!isInstallationRootRequest()) {
    res.json({
      installationRoot: false,
      core: "absent",
      verified: 0,
      unverifiable: 0,
      failed: 0,
      packages: [],
    });
    return;
  }
  try {
    res.json({ installationRoot: true, ...(await loadIntegrityOverview(false)) });
  } catch (e) {
    sendServerError(res, "security", e);
  }
});

router.post("/integrity/scan", adminOnly, integrityRateLimit, async (req, res) => {
  if (!isInstallationRootRequest()) {
    res.status(403).json({ error: "File integrity is checked on the platform site." });
    return;
  }
  try {
    const overview = await loadIntegrityOverview(true);
    const paths = overview.packages
      .filter((item) => item.status !== "verified" && item.status !== "unverifiable")
      .flatMap((item) => [item.packageId, ...item.modified, ...item.missing, ...item.unexpected])
      .slice(0, 20);
    auditFromRequest(req, "integrity.scanned", {
      outcome: overview.failed > 0 || overview.core === "failed" ? "failure" : "success",
      detail: `core ${overview.core}; failed ${overview.failed}; ${paths.join(", ")}`.replace(/[\r\n]/g, " ").slice(0, 500),
    });
    res.json({ installationRoot: true, ...overview });
  } catch (e) {
    sendServerError(res, "security", e);
  }
});

router.get("/admin-path", adminOnly, async (_req, res) => {
  try {
    const config = await getAdminPathConfig();
    res.json({ config, recoveryOverride: Boolean(process.env.JF_ADMIN_PATH_RECOVERY) });
  } catch (e) {
    sendServerError(res, "security", e);
  }
});

router.post("/admin-path/preview", adminOnly, (req, res) => {
  try {
    const path = req.body?.path === "/admin" ? "/admin" : validateAdminPath(req.body?.path);
    res.json({ ok: true, path, loginUrl: `${path}/security/admin-path` });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Invalid admin path." });
  }
});

router.put("/admin-path", adminOnly, async (req, res) => {
  try {
    if (process.env.JF_ADMIN_PATH_RECOVERY) {
      res.status(409).json({ error: "Remove JF_ADMIN_PATH_RECOVERY before saving this setting." });
      return;
    }
    const previous = await getAdminPathConfig();
    const config = await saveAdminPathConfig({
      path: req.body?.path,
      oldPathBehavior: req.body?.oldPathBehavior,
    });
    auditFromRequest(req, "security.admin_path_changed", {
      target: "security.admin_path",
      detail: `${previous.path} -> ${config.path}`,
    });
    res.json({ ok: true, config, previous });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid admin path.";
    if (/path|reserved|allowed|trailing/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    sendServerError(res, "security", e);
  }
});

/** What each scope produces, so the admin can see the real headers before saving. */
function effectiveHeaders(config: SecurityHeadersConfig) {
  return {
    publicSecure: resolveHeaders(config, { area: "public", secure: true }),
    publicInsecure: resolveHeaders(config, { area: "public", secure: false }),
    admin: resolveHeaders(config, { area: "admin", secure: true }),
  };
}

function zodMessage(e: unknown): string | null {
  if (!(e instanceof z.ZodError)) return null;
  return e.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

router.get("/headers", adminOnly, async (_req, res) => {
  try {
    const config = await getSecurityHeadersConfig();
    res.json({
      config,
      catalog: SECURITY_HEADER_DEFS,
      defaults: defaultConfig(),
      recommended: recommendedConfig(),
      audit: auditConfig(config),
      effective: effectiveHeaders(config),
      killSwitch: process.env.JF_SECURITY_HEADERS_DISABLED === "1",
    });
  } catch (e) {
    sendServerError(res, "security", e);
  }
});

router.put("/headers", adminOnly, async (req, res) => {
  try {
    const config = SecurityHeadersConfigSchema.parse(req.body);
    await saveSecurityHeadersConfig(config);
    // Weakening the header policy is a way to make a later attack work; the
    // change needs to be attributable.
    auditFromRequest(req, "security.headers_changed", {
      target: "security_headers",
      detail: "reset to defaults",
    });
    res.json({
      ok: true,
      config,
      audit: auditConfig(config),
      effective: effectiveHeaders(config),
    });
  } catch (e) {
    const message = zodMessage(e);
    if (message) {
      res.status(400).json({ error: message });
      return;
    }
    sendServerError(res, "security", e);
  }
});

router.post("/headers/reset", adminOnly, async (req, res) => {
  try {
    const config = defaultConfig();
    await saveSecurityHeadersConfig(config);
    // Weakening the header policy is a way to make a later attack work; the
    // change needs to be attributable.
    auditFromRequest(req, "security.headers_changed", {
      target: "security_headers",
      detail: "reset to defaults",
    });
    res.json({
      ok: true,
      config,
      audit: auditConfig(config),
      effective: effectiveHeaders(config),
    });
  } catch (e) {
    sendServerError(res, "security", e);
  }
});

/**
 * Grade a draft without saving it, so the editor can show the effect of a
 * change before the site starts sending it. Deliberately lenient: a config
 * being edited is allowed to be half-finished.
 */
router.post("/audit", adminOnly, (req, res) => {
  try {
    const config = normalizeConfig(req.body?.config);
    res.json({ audit: auditConfig(config), effective: effectiveHeaders(config) });
  } catch (e) {
    sendServerError(res, "security", e);
  }
});

export default router;
