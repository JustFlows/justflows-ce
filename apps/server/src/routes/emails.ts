// SPDX-License-Identifier: MIT

import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { requireCapability } from "../middleware/auth.js";
import { getSiteId } from "../lib/site-settings.js";
import { getDefaultLocale, listLanguages } from "../lib/i18n/languages-db.js";
import { sendMail } from "../lib/mail.js";
import { auditFromRequest } from "../lib/audit-log.js";
import { sendServerError } from "../lib/send-error.js";
import {
  DEFAULT_EMAIL_DESIGN,
  defaultEmailTemplateContent,
  getEmailDesign,
  getTemplateRow,
  listEmailTemplateDefinitions,
  listManagedEmailTemplates,
  previewValues,
  renderEmailTemplate,
  renderEmailSource,
  saveEmailDesign,
  saveEmailTemplate,
} from "../lib/email-templates.js";

const router = Router();
const localeSchema = z.string().regex(/^[a-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$/).max(20);
const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);
const assetUrl = z.string().max(2048).refine((value) => !value || value.startsWith("/uploads/") || /^https:\/\//i.test(value), "Use an HTTPS or uploaded asset URL");
const designSchema = z.object({ logoUrl: assetUrl, darkLogoUrl: assetUrl, accentColor: colorSchema, pageBackground: colorSchema, contentBackground: colorSchema, textColor: colorSchema, fontFamily: z.string().min(1).max(300), contentWidth: z.coerce.number().int().min(320).max(800), radius: z.coerce.number().int().min(0).max(48), alignment: z.enum(["left", "center"]), companyName: z.string().max(200), address: z.string().max(500), supportContact: z.string().max(320), footerText: z.string().max(1000) });
const templateSchema = z.object({ locale: localeSchema, enabled: z.boolean(), senderName: z.string().max(120), replyToPolicy: z.enum(["global", "none"]), subject: z.string().min(1).max(500).refine((value) => !/[\r\n]/.test(value), "Subject cannot contain line breaks"), preheader: z.string().max(500), html: z.string().min(1).max(200_000), text: z.string().min(1).max(100_000), publish: z.boolean().default(false) });

async function activeLanguages(siteId: string) {
  return listLanguages(siteId, true);
}

async function isConfiguredLocale(siteId: string, locale: string): Promise<boolean> {
  return (await activeLanguages(siteId)).some((language) => language.code === locale);
}

router.get("/", requireCapability("email-templates:read"), async (req, res) => {
  try {
    const siteId = await getSiteId();
    if (!siteId) { res.status(503).json({ error: "No site found" }); return; }
    const languages = await activeLanguages(siteId);
    const parsed = localeSchema.safeParse(req.query.locale);
    const locale = parsed.success && languages.some((language) => language.code === parsed.data)
      ? parsed.data
      : await getDefaultLocale(siteId);
    res.json({ locale, languages, templates: await listManagedEmailTemplates(siteId, locale), design: await getEmailDesign(siteId) });
  } catch (error) { sendServerError(res, "emails", error); }
});

router.put("/design", requireCapability("email-templates:manage"), async (req, res) => {
  try {
    const siteId = await getSiteId();
    if (!siteId) { res.status(503).json({ error: "No site found" }); return; }
    const body = z.object({ design: designSchema, publish: z.boolean().default(false) }).parse(req.body);
    const version = await saveEmailDesign(siteId, body.design, req.session!.userId, body.publish);
    auditFromRequest(req, body.publish ? "email.design_published" : "email.design_saved", { target: `design:v${version}` });
    res.json({ ok: true, version, status: body.publish ? "published" : "draft" });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: error.issues[0]?.message ?? "Invalid design" }); return; }
    sendServerError(res, "emails", error);
  }
});

router.post("/design/restore", requireCapability("email-templates:manage"), async (req, res) => {
  try {
    const siteId = await getSiteId();
    if (!siteId) { res.status(503).json({ error: "No site found" }); return; }
    const version = await saveEmailDesign(siteId, DEFAULT_EMAIL_DESIGN, req.session!.userId, false);
    auditFromRequest(req, "email.design_restored", { target: `design:v${version}` });
    res.json({ ok: true, version, design: DEFAULT_EMAIL_DESIGN });
  } catch (error) { sendServerError(res, "emails", error); }
});

router.put("/:key", requireCapability("email-templates:manage"), async (req, res) => {
  try {
    const siteId = await getSiteId();
    if (!siteId) { res.status(503).json({ error: "No site found" }); return; }
    const key = z.string().max(160).parse(req.params.key);
    const body = templateSchema.parse(req.body);
    if (!(await isConfiguredLocale(siteId, body.locale))) { res.status(400).json({ error: "Select an active language configured under Admin → Languages" }); return; }
    const definition = listEmailTemplateDefinitions().find((item) => item.key === key);
    if (!definition) { res.status(404).json({ error: "Email template not found" }); return; }
    if (!body.enabled && !definition.disableSafe) { res.status(400).json({ error: "Security and account templates cannot be disabled" }); return; }
    const check = renderEmailSource({ key, values: previewValues(definition), source: { subject: body.subject, preheader: body.preheader, html: body.html, text: body.text }, design: (await getEmailDesign(siteId)).design });
    if (body.publish && check.errors.length) { res.status(400).json({ error: check.errors[0], errors: check.errors }); return; }
    const version = await saveEmailTemplate(siteId, key, body.locale, body, req.session!.userId, body.publish);
    auditFromRequest(req, body.publish ? "email.template_published" : "email.template_saved", { target: `${key}:${body.locale}:v${version}` });
    res.json({ ok: true, version, status: body.publish ? "published" : "draft" });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: error.issues[0]?.message ?? "Invalid template" }); return; }
    sendServerError(res, "emails", error);
  }
});

router.post("/:key/restore", requireCapability("email-templates:manage"), async (req, res) => {
  try {
    const siteId = await getSiteId();
    if (!siteId) { res.status(503).json({ error: "No site found" }); return; }
    const key = z.string().max(160).parse(req.params.key);
    const locale = localeSchema.parse(req.body?.locale);
    if (!(await isConfiguredLocale(siteId, locale))) { res.status(400).json({ error: "Select an active language configured under Admin → Languages" }); return; }
    const definition = listEmailTemplateDefinitions().find((item) => item.key === key);
    if (!definition) { res.status(404).json({ error: "Email template not found" }); return; }
    const defaults = defaultEmailTemplateContent(definition, locale);
    const version = await saveEmailTemplate(siteId, key, locale, { enabled: true, senderName: "", replyToPolicy: "global", subject: defaults.subject, preheader: defaults.preheader, html: defaults.html, text: defaults.text }, req.session!.userId, false);
    auditFromRequest(req, "email.template_restored", { target: `${key}:${locale}:v${version}` });
    res.json({ ok: true, version });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: error.issues[0]?.message ?? "Invalid request" }); return; }
    sendServerError(res, "emails", error);
  }
});

router.post("/:key/preview", requireCapability("email-templates:read"), async (req, res) => {
  try {
    const siteId = await getSiteId();
    if (!siteId) { res.status(503).json({ error: "No site found" }); return; }
    const key = z.string().max(160).parse(req.params.key);
    const definition = listEmailTemplateDefinitions().find((item) => item.key === key);
    if (!definition) { res.status(404).json({ error: "Email template not found" }); return; }
    const body = z.object({ locale: localeSchema.optional(), values: z.record(z.string(), z.string().max(4000)).optional(), mode: z.enum(["draft", "published"]).default("draft"), template: z.object({ subject: z.string().max(500), preheader: z.string().max(500), html: z.string().max(200_000), text: z.string().max(100_000) }).optional(), design: designSchema.partial().optional() }).parse(req.body);
    if (body.locale && !(await isConfiguredLocale(siteId, body.locale))) { res.status(400).json({ error: "Select an active language configured under Admin → Languages" }); return; }
    const values = { ...previewValues(definition), ...body.values };
    if (body.template) {
      // `design` lets the editor preview unsaved brand changes live; missing keys fall back to the stored design.
      const design = { ...(await getEmailDesign(siteId, body.mode)).design, ...body.design };
      res.json(renderEmailSource({ key, values, source: body.template, design }));
      return;
    }
    res.json(await renderEmailTemplate({ siteId, key, locale: body.locale, values, mode: body.mode }));
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: error.issues[0]?.message ?? "Invalid preview" }); return; }
    sendServerError(res, "emails", error);
  }
});

const testLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many test emails" } });
router.post("/:key/test", testLimit, requireCapability("email-templates:manage"), async (req, res) => {
  try {
    const siteId = await getSiteId();
    if (!siteId) { res.status(503).json({ error: "No site found" }); return; }
    const key = z.string().max(160).parse(req.params.key);
    const definition = listEmailTemplateDefinitions().find((item) => item.key === key);
    if (!definition) { res.status(404).json({ error: "Email template not found" }); return; }
    const body = z.object({ to: z.string().email(), locale: localeSchema.optional() }).parse(req.body);
    if (body.locale && !(await isConfiguredLocale(siteId, body.locale))) { res.status(400).json({ error: "Select an active language configured under Admin → Languages" }); return; }
    const rendered = await renderEmailTemplate({ siteId, key, locale: body.locale, values: previewValues(definition), mode: "draft" });
    const result = await sendMail({ to: body.to, subject: `[TEST] ${rendered.subject}`, html: rendered.html, text: rendered.text, type: `${key}:test` });
    auditFromRequest(req, "email.template_tested", { target: key, outcome: result.ok ? "success" : "failure" });
    res.status(result.ok ? 200 : 502).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: error.issues[0]?.message ?? "Invalid test" }); return; }
    sendServerError(res, "emails", error);
  }
});

export default router;
