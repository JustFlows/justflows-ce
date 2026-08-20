// SPDX-License-Identifier: MIT

import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../middleware/auth.js";
import { auditConfig } from "../lib/security-audit.js";
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
} from "../lib/security-headers.js";

const router = Router();

/** Security configuration is an administrator-only surface, read included. */
const adminOnly = requireRole("administrator");

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
    res.status(500).json({ error: String(e) });
  }
});

router.put("/headers", adminOnly, async (req, res) => {
  try {
    const config = SecurityHeadersConfigSchema.parse(req.body);
    await saveSecurityHeadersConfig(config);
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
    res.status(500).json({ error: String(e) });
  }
});

router.post("/headers/reset", adminOnly, async (_req, res) => {
  try {
    const config = defaultConfig();
    await saveSecurityHeadersConfig(config);
    res.json({
      ok: true,
      config,
      audit: auditConfig(config),
      effective: effectiveHeaders(config),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
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
    res.status(500).json({ error: String(e) });
  }
});

export default router;
