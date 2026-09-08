// SPDX-License-Identifier: MIT
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { requireRole } from "../middleware/auth.js";
import {
  listRedirects,
  saveRedirects,
  listNotFound,
  clearNotFound,
  redirectContext,
} from "../lib/redirects-db.js";
import {
  exportRedirectCsv,
  importRedirectCsv,
  RedirectValidationError,
  validateRedirect,
} from "../lib/redirects.js";
import { auditFromRequest } from "../lib/audit-log.js";
import { sendServerError } from "../lib/send-error.js";

const router = Router();
router.use(
  requireRole("administrator"),
  rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }),
);
router.get("/", async (req, res) => {
  try {
    const rules = await listRedirects(req.session!.siteId);
    const context = await redirectContext(req.session!.siteId);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      rules,
      content: context.content,
      suggestions: context.history.filter(
        (h) => !rules.some((r) => r.source === h.source && r.kind === "exact"),
      ),
    });
  } catch (err) {
    sendServerError(res, "redirects", err);
  }
});
router.get("/export", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "private, no-store");
    res
      .attachment("redirects.csv")
      .type("text/csv")
      .send(exportRedirectCsv(await listRedirects(req.session!.siteId)));
  } catch (err) {
    sendServerError(res, "redirects", err);
  }
});
router.get("/not-found", async (req, res) => {
  const query = z
    .object({ offset: z.coerce.number().int().min(0).max(10000).default(0) })
    .safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid offset." });
    return;
  }
  try {
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ entries: await listNotFound(req.session!.siteId, query.data.offset) });
  } catch (err) {
    sendServerError(res, "redirects", err);
  }
});
router.delete("/not-found", async (req, res) => {
  try {
    await clearNotFound(req.session!.siteId);
    auditFromRequest(req, "redirect.logs_cleared");
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, "redirects", err);
  }
});
router.post("/import", async (req, res) => {
  try {
    if (typeof req.body?.csv !== "string") throw new RedirectValidationError("Provide CSV text.");
    const rules = await saveRedirects(req.session!.siteId, importRedirectCsv(req.body.csv));
    auditFromRequest(req, "redirect.imported", { detail: `${rules.length} redirects` });
    res.status(201).json({ rules });
  } catch (err) {
    if (err instanceof RedirectValidationError) res.status(400).json({ error: err.message });
    else sendServerError(res, "redirects", err);
  }
});
router.post("/", async (req, res) => {
  try {
    const [rule] = await saveRedirects(req.session!.siteId, [validateRedirect(req.body)]);
    auditFromRequest(req, "redirect.created", { target: rule!.id });
    res.status(201).json({ rule });
  } catch (err) {
    if (err instanceof RedirectValidationError) res.status(400).json({ error: err.message });
    else sendServerError(res, "redirects", err);
  }
});
router.put("/:id", async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) {
    res.status(400).json({ error: "Invalid redirect ID." });
    return;
  }
  try {
    const [rule] = await saveRedirects(
      req.session!.siteId,
      [validateRedirect(req.body)],
      req.params.id as string,
    );
    auditFromRequest(req, "redirect.updated", { target: rule!.id });
    res.json({ rule });
  } catch (err) {
    if (err instanceof RedirectValidationError)
      res.status(err.message === "Redirect not found." ? 404 : 400).json({ error: err.message });
    else sendServerError(res, "redirects", err);
  }
});
export default router;
