// SPDX-License-Identifier: MIT

import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../../middleware/auth.js";
import { addressReference, erasePersonalData, exportPersonalData, FINANCIAL_RETENTION_SETTING, financialRetentionYears } from "../../lib/auth/personal-data.js";
import { setSiteSetting } from "../../lib/settings/site-settings.js";
import { auditLog } from "../../lib/security/audit-log.js";
import { sendServerError } from "../../lib/http/send-error.js";
import { completeErasureRequest, declineErasureRequest, listDataRequests, saveSelfServiceSettings, selfServiceSettings } from "../../lib/auth/data-requests.js";
import type { Request } from "express";

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
    const siteId = req.session!.siteId;
    const [years, selfService] = await Promise.all([financialRetentionYears(siteId), selfServiceSettings(siteId)]);
    res.json({ financialRecordsYears: years, selfServiceDownload: selfService.download, selfServiceErasure: selfService.erasure });
  } catch (err) {
    sendServerError(res, "privacy", err);
  }
});

/**
 * Any of: the retention years, and whether members may download their data
 * or ask for its removal from their own "Your data" page.
 */
const SettingsSchema = z.object({
  financialRecordsYears: z.number().int().min(0).max(30).optional(),
  selfServiceDownload: z.boolean().optional(),
  selfServiceErasure: z.boolean().optional(),
}).refine((value) => Object.values(value).some((field) => field !== undefined));

router.put("/settings", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  const body = SettingsSchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "Enter a whole number of years from 0 to 30." });
    return;
  }
  try {
    const audit = (target: string, detail: string) => void auditLog({ siteId: session.siteId, action: "settings.changed", actorId: session.userId, actorRole: session.role, target, detail });
    if (body.data.financialRecordsYears !== undefined) {
      const previous = await financialRetentionYears(session.siteId);
      await setSiteSetting(session.siteId, FINANCIAL_RETENTION_SETTING, body.data.financialRecordsYears);
      audit(FINANCIAL_RETENTION_SETTING, `${previous} → ${body.data.financialRecordsYears} years`);
    }
    const before = await selfServiceSettings(session.siteId);
    const after = await saveSelfServiceSettings(session.siteId, { download: body.data.selfServiceDownload, erasure: body.data.selfServiceErasure });
    if (before.download !== after.download) audit("privacy_self_download", `${before.download} → ${after.download}`);
    if (before.erasure !== after.erasure) audit("privacy_self_erasure", `${before.erasure} → ${after.erasure}`);
    res.json({ financialRecordsYears: await financialRetentionYears(session.siteId), selfServiceDownload: after.download, selfServiceErasure: after.erasure });
  } catch (err) {
    sendServerError(res, "privacy", err);
  }
});

/** Members' removal requests: open ones by due date, or the 100 most recently handled. */
router.get("/requests", requireRole("administrator"), async (req, res) => {
  try {
    res.json({ requests: await listDataRequests(req.session!.siteId, req.query.scope === "handled" ? "handled" : "open") });
  } catch (err) {
    sendServerError(res, "privacy", err);
  }
});

function actorOf(req: Request) {
  const session = req.session!;
  return { siteId: session.siteId, userId: session.userId, role: session.role, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
}

const IdSchema = z.string().uuid();

/** Carry it out: erase everywhere, keep what the law requires, delete the account, tell the member. */
router.post("/requests/:id/complete", requireRole("administrator"), async (req, res) => {
  const id = IdSchema.safeParse(req.params.id);
  if (!id.success || req.body?.confirm !== true) {
    res.status(400).json({ error: "Erasing cannot be undone. Confirm it first." });
    return;
  }
  try {
    const result = await completeErasureRequest(req.session!.siteId, id.data, actorOf(req));
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ request: result.request, erasure: result.erasure });
  } catch (err) {
    sendServerError(res, "privacy", err);
  }
});

const DeclineSchema = z.object({ reason: z.string().trim().min(1).max(2000) });

/** Decline it, with the reason the member is sent. */
router.post("/requests/:id/decline", requireRole("administrator"), async (req, res) => {
  const id = IdSchema.safeParse(req.params.id);
  const body = DeclineSchema.safeParse(req.body ?? {});
  if (!id.success || !body.success) {
    res.status(400).json({ error: "Write the reason the member will be sent." });
    return;
  }
  try {
    const result = await declineErasureRequest(req.session!.siteId, id.data, actorOf(req), body.data.reason);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ request: result.request });
  } catch (err) {
    sendServerError(res, "privacy", err);
  }
});

export default router;
