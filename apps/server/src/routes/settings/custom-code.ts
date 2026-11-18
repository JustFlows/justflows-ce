// SPDX-License-Identifier: MIT

import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { requireCapability } from "../../middleware/auth.js";
import { auditFromRequest } from "../../lib/security/audit-log.js";
import { sendServerError } from "../../lib/http/send-error.js";
import {
  currentEnvironment,
  customCodeDisabledByEnvironment,
  getCustomCode,
  getCustomCodeHistory,
  saveCustomCode,
  validateCustomCode,
} from "../../lib/custom-code/custom-code.js";
import { SNIPPET_LIBRARY } from "../../lib/custom-code/library.js";

/**
 * Custom JavaScript and markup on public pages (justflows-ce#94). Every route
 * needs the `code:manage` capability, which only administrators hold by
 * default. Every change is audited with a diff and kept as a version.
 */
const router = Router();
const writeLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });

function library() {
  return SNIPPET_LIBRARY.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    consent: template.consent,
    params: template.params.map((param) => ({ id: param.id, label: param.label, example: param.example, optional: param.optional === true })),
  }));
}

router.get("/", requireCapability("code:manage"), async (req, res) => {
  try {
    const siteId = req.session!.siteId;
    const history = await getCustomCodeHistory(siteId);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      config: await getCustomCode(siteId),
      library: library(),
      environment: currentEnvironment(),
      disabledByEnvironment: customCodeDisabledByEnvironment(),
      versions: history.map((entry) => ({ version: entry.version, savedAt: entry.savedAt, savedBy: entry.savedBy })),
    });
  } catch (error) {
    sendServerError(res, "custom-code", error);
  }
});

router.get("/versions/:version", requireCapability("code:manage"), async (req, res) => {
  const version = Number(req.params.version);
  const entry = (await getCustomCodeHistory(req.session!.siteId)).find((item) => item.version === version);
  if (!entry) {
    res.status(404).json({ error: "Version not found" });
    return;
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.json(entry);
});

/** Check a draft without saving it: errors and warnings for the editor. */
router.post("/validate", writeLimit, requireCapability("code:manage"), async (req, res) => {
  const result = await validateCustomCode(req.body);
  res.json({ ok: result.errors.length === 0, errors: result.errors, warnings: result.warnings });
});

router.put("/", writeLimit, requireCapability("code:manage"), async (req, res) => {
  try {
    const result = await validateCustomCode(req.body);
    if (!result.config) {
      res.status(400).json({ error: result.errors[0], errors: result.errors, warnings: result.warnings });
      return;
    }
    const saved = await saveCustomCode(req.session!.siteId, result.config, { userId: req.session!.userId });
    auditFromRequest(req, "custom_code.changed", { target: `version ${saved.version}`, detail: saved.diff });
    res.json({ ok: true, version: saved.version, warnings: result.warnings, config: await getCustomCode(req.session!.siteId) });
  } catch (error) {
    sendServerError(res, "custom-code", error);
  }
});

/** Safe mode turns every snippet off at once, for recovery, without losing them. */
router.post("/safe-mode", writeLimit, requireCapability("code:manage"), async (req, res) => {
  try {
    const enabled = req.body?.enabled === true;
    const current = await getCustomCode(req.session!.siteId);
    const saved = await saveCustomCode(req.session!.siteId, { ...current, safeMode: enabled }, { userId: req.session!.userId });
    auditFromRequest(req, "custom_code.safe_mode", { target: `version ${saved.version}`, detail: enabled ? "safe mode on: all custom code is off" : "safe mode off" });
    res.json({ ok: true, safeMode: enabled, version: saved.version });
  } catch (error) {
    sendServerError(res, "custom-code", error);
  }
});

export default router;
