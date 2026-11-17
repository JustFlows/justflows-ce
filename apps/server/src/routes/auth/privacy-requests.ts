// SPDX-License-Identifier: MIT

import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../../middleware/auth.js";
import { addressReference, erasePersonalData, exportPersonalData, FINANCIAL_RETENTION_SETTING, financialRetentionYears } from "../../lib/auth/personal-data.js";
import { setSiteSetting } from "../../lib/settings/site-settings.js";
import { auditLog } from "../../lib/security/audit-log.js";
import { sendServerError } from "../../lib/http/send-error.js";

/**
 * Data requests by email address (GDPR Art. 15 and 17), for people who may
 * have no account: guests who booked, ordered, or filled in a form. The same
 * export and erasure as the user page (`/api/users/:id/personal-data`,
 * `/api/users/:id/erase`), across core and every active plugin. When the
 * address belongs to an account, that account is used, so both ways give the
 * same answer. Administrator only; every request is audited without the
 * address.
 */
const router = Router();

const EmailSchema = z.string().trim().toLowerCase().email().max(200);

router.get("/export", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  const email = EmailSchema.safeParse(req.query.email);
  if (!email.success) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }
  try {
    const data = await exportPersonalData(session.siteId, { email: email.data }, { userId: session.userId, role: session.role });
    if (!data) {
      res.status(404).json({ error: "Nothing found." });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `attachment; filename="personal-data-${addressReference(email.data)}.json"`);
    res.json(data);
  } catch (err) {
    sendServerError(res, "privacy", err);
  }
});

const EraseSchema = z.object({
  email: EmailSchema,
  /** Required: erasure cannot be undone. */
  confirm: z.literal(true),
  reassignContentTo: z.string().uuid().nullable().optional(),
});

router.post("/erase", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  const body = EraseSchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.issues.some((issue) => issue.path[0] === "confirm") ? "Erasing cannot be undone. Confirm it first." : "Enter a valid email address." });
    return;
  }
  try {
    const result = await erasePersonalData(session.siteId, { email: body.data.email }, body.data.reassignContentTo ?? null, { userId: session.userId, role: session.role });
    res.json({ ok: true, ...result });
  } catch (err) {
    sendServerError(res, "privacy", err);
  }
});

/**
 * How long financial records are kept by law. Plugins get it with every
 * request: they keep what an invoice legally needs for this long and remove
 * the rest at once.
 */
router.get("/settings", requireRole("administrator"), async (req, res) => {
  try {
    res.json({ financialRecordsYears: await financialRetentionYears(req.session!.siteId) });
  } catch (err) {
    sendServerError(res, "privacy", err);
  }
});

const SettingsSchema = z.object({ financialRecordsYears: z.number().int().min(0).max(30) });

router.put("/settings", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  const body = SettingsSchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "Enter a whole number of years from 0 to 30." });
    return;
  }
  try {
    const previous = await financialRetentionYears(session.siteId);
    await setSiteSetting(session.siteId, FINANCIAL_RETENTION_SETTING, body.data.financialRecordsYears);
    void auditLog({ siteId: session.siteId, action: "settings.changed", actorId: session.userId, actorRole: session.role, target: FINANCIAL_RETENTION_SETTING, detail: `${previous} → ${body.data.financialRecordsYears} years` });
    res.json({ financialRecordsYears: body.data.financialRecordsYears });
  } catch (err) {
    sendServerError(res, "privacy", err);
  }
});

export default router;
