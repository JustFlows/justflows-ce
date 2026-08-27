// SPDX-License-Identifier: MIT

import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../middleware/auth.js";
import {
  AUDIT_ACTIONS,
  auditRetentionDays,
  listAuditLog,
  pruneAuditLog,
} from "../lib/audit-log.js";
import { sendServerError } from "../lib/send-error.js";

const router = Router();

const QuerySchema = z.object({
  action: z.enum(AUDIT_ACTIONS).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  before: z.string().max(40).optional(),
});

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
    const entries = await listAuditLog({ siteId: req.session!.siteId, ...parsed.data });
    res.json({
      entries,
      actions: AUDIT_ACTIONS,
      retentionDays: auditRetentionDays(),
    });
  } catch (err) {
    sendServerError(res, "audit", err);
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
