import { Router } from "express";
import { requireRole } from "../middleware/auth.js";
import { param } from "../lib/params.js";
import {
  deleteForm,
  deleteSubmission,
  getForm,
  isFormsPluginEnabled,
  listForms,
  listSubmissions,
  saveForm,
} from "../lib/forms-public.js";
import { sendServerError } from "../lib/send-error.js";

const router = Router();

router.get("/", requireRole("administrator", "editor"), async (req, res) => {
  try {
    const siteId = req.session!.siteId;
    const enabled = await isFormsPluginEnabled(siteId);
    const forms = enabled ? await listForms(siteId) : [];
    res.json({ enabled, forms });
  } catch (err) {
    sendServerError(res, "forms", err);
  }
});

router.get("/:id/submissions", requireRole("administrator", "editor"), async (req, res) => {
  try {
    const siteId = req.session!.siteId;
    if (!(await isFormsPluginEnabled(siteId))) {
      res.status(404).json({ error: "Forms plugin is not available" });
      return;
    }
    const formId = param(req.params.id);
    const form = await getForm(siteId, formId);
    if (!form) {
      res.status(404).json({ error: "Form not found" });
      return;
    }
    res.json({ form, submissions: await listSubmissions(siteId, formId) });
  } catch (err) {
    sendServerError(res, "forms", err);
  }
});

router.put("/:id", requireRole("administrator"), async (req, res) => {
  try {
    const siteId = req.session!.siteId;
    if (!(await isFormsPluginEnabled(siteId))) {
      res.status(404).json({ error: "Forms plugin is not available" });
      return;
    }
    const form = await saveForm(siteId, param(req.params.id), req.body);
    const { revalidateOnUpdate } = await import("../lib/cache-revalidate.js");
    await revalidateOnUpdate("plugin");
    res.json({ form });
  } catch (err) {
    sendServerError(res, "forms", err);
  }
});

router.post("/", requireRole("administrator"), async (req, res) => {
  try {
    const siteId = req.session!.siteId;
    if (!(await isFormsPluginEnabled(siteId))) {
      res.status(404).json({ error: "Forms plugin is not available" });
      return;
    }
    const requestedId = typeof req.body?.id === "string" ? req.body.id : undefined;
    const form = await saveForm(siteId, requestedId, req.body);
    const { revalidateOnUpdate } = await import("../lib/cache-revalidate.js");
    await revalidateOnUpdate("plugin");
    res.json({ form });
  } catch (err) {
    sendServerError(res, "forms", err);
  }
});

router.delete("/:id/submissions/:submissionId", requireRole("administrator"), async (req, res) => {
  try {
    await deleteSubmission(req.session!.siteId, param(req.params.submissionId));
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, "forms", err);
  }
});

router.delete("/:id", requireRole("administrator"), async (req, res) => {
  try {
    await deleteForm(req.session!.siteId, param(req.params.id));
    const { revalidateOnUpdate } = await import("../lib/cache-revalidate.js");
    await revalidateOnUpdate("plugin");
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, "forms", err);
  }
});

export default router;
