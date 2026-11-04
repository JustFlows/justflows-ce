// SPDX-License-Identifier: MIT

import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../../middleware/auth.js";
import {
  AUDIT_ACTIONS,
  SECURITY_AUDIT_ACTIONS,
  auditRetentionDays,
  listAuditLog,
  pruneAuditLog,
  auditFromRequest,
} from "../../lib/security/audit-log.js";
import {
  getSecurityNotificationStatus,
  setSecurityNotificationSettings,
} from "../../lib/security/security-notifications.js";
import { sendServerError } from "../../lib/http/send-error.js";

const router = Router();

const QuerySchema = z.object({
  action: z.enum(AUDIT_ACTIONS).optional(),
  view: z.enum(["all", "security"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  before: z.string().max(40).optional(),
});

const NotificationSettingsSchema = z.object({
  enabled: z.boolean(),
  networkEnabled: z.boolean().optional(),
}).strict();

/**
 * Administrator only.
 *
 * The trail names who did what from which address — it is a record about
 * people, and an editor has no business reading it.
 */
router.get("/", requireRole("administrator"), async (req, res) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid query" });
    return;
  }

  try {
    const view = parsed.data.view ?? "all";
    if (view === "security" && parsed.data.action && !SECURITY_AUDIT_ACTIONS.includes(parsed.data.action)) {
      res.status(400).json({ error: "Action is not available in the security event view" });
      return;
    }
    const entries = await listAuditLog({ siteId: req.session!.siteId, ...parsed.data });
    res.json({
      entries,
      actions: view === "security" ? SECURITY_AUDIT_ACTIONS : AUDIT_ACTIONS,
      view,
      retentionDays: auditRetentionDays(),
    });
  } catch (err) {
    sendServerError(res, "audit", err);
  }
});

/** Read the site-specific, opt-in security notification policy. */
router.get("/notifications", requireRole("administrator"), async (req, res) => {
  try {
    res.json(await getSecurityNotificationStatus(req.session!.siteId));
  } catch (err) {
    sendServerError(res, "security notifications", err);
  }
});

/** Change only this site's notification policy; the recipient stays the administration address. */
router.put("/notifications", requireRole("administrator"), async (req, res) => {
  const parsed = NotificationSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid settings" });
    return;
  }
  try {
    const status = await setSecurityNotificationSettings(req.session!.siteId, parsed.data);
    auditFromRequest(req, "security.notifications_changed", {
      detail: parsed.data.enabled ? "enabled" : "disabled",
    });
    res.json(status);
  } catch (err) {
    sendServerError(res, "security notifications", err);
  }
});

/**
 * Apply the retention window now.
 *
 * The trail holds IP addresses, so it is personal data and cannot be kept
 * indefinitely (GDPR Art. 5(1)(e)). There is no scheduler in CE, so retention
 * is enforced here and on each write path's own schedule rather than silently
 * never.
 */
router.post("/prune", requireRole("administrator"), async (req, res) => {
  try {
    const removed = await pruneAuditLog(req.session!.siteId);
    res.json({ ok: true, removed, retentionDays: auditRetentionDays() });
  } catch (err) {
    sendServerError(res, "audit", err);
  }
});

export default router;
