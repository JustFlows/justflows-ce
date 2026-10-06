// SPDX-License-Identifier: MIT

import { Router, type Request } from "express";
import { z } from "zod";
import { getDefaultLocale, listLanguages } from "../../lib/i18n/languages-db.js";
import {
  addRule,
  addSpamTerm,
  listRules,
  listSpamTerms,
  removeRule,
  removeSpamTerm,
  RULE_FIELD_VALUES,
  RULE_LIST_VALUES,
  type RuleActor,
} from "../../lib/comments/comments-rules.js";
import { listTrash, purgeTrashItem, restoreTrashItem } from "../../lib/content/trash.js";
import { invalidatePublicPages } from "../../lib/cache/public-cache.js";
import {
  DEFAULT_EMAIL_DESIGN,
  defaultEmailTemplateContent,
  getEmailDesign,
  listEmailTemplateDefinitions,
  listManagedEmailTemplates,
  previewValues,
  renderEmailSource,
  renderEmailTemplate,
  saveEmailDesign,
  saveEmailTemplate,
} from "../../lib/email/email-templates.js";
import { sendServerError } from "../../lib/http/send-error.js";
import { param } from "../../lib/http/params.js";
import { getAnalyticsSummary } from "../../lib/rendering/analytics-public.js";
import { auditFromRequest } from "../../lib/security/audit-log.js";
import { getCookieOverrides, getResolvedCookieRegistry, setCookieOverrides } from "../../lib/security/cookie-registry.js";
import { clientIp } from "../../lib/security/rate-limit.js";
import { badRequest, ensureKeyCan, sendJson } from "./envelope.js";

/**
 * The rest of the administrator surface that is JSON in and JSON out:
 * trash, analytics, comment rules, cookies, and email templates.
 * Zip installs, signing secrets, and replacing the running app stay on the
 * cookie API.
 */

const router = Router();

function siteId(req: Request): string {
  return req.apiKeyOwner!.siteId;
}

function actorOf(req: Request): RuleActor {
  const owner = req.apiKeyOwner!;
  return {
    siteId: owner.siteId,
    userId: owner.userId,
    role: owner.role,
    ip: clientIp(req),
    userAgent: req.get("user-agent") ?? null,
  };
}

const TrashType = z.enum(["content", "media", "comment", "menu"]);
const TrashBulk = z.object({
  items: z.array(z.object({ type: TrashType, id: z.string().uuid() })).min(1).max(200),
});

const RuleSchema = z.object({
  list: z.enum(RULE_LIST_VALUES),
  field: z.enum(RULE_FIELD_VALUES),
  pattern: z.string().trim().min(1).max(500),
  note: z.string().max(500).optional(),
});

const SpamTermSchema = z.object({
  kind: z.enum(["domain", "phrase"]),
  value: z.string().trim().min(1).max(255),
});

const localeSchema = z.string().regex(/^[a-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$/).max(20);
const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);
const assetUrl = z
  .string()
  .max(2048)
  .refine((value) => !value || value.startsWith("/uploads/") || /^https:\/\//i.test(value), "Use an HTTPS or uploaded asset URL");
const designSchema = z.object({
  logoUrl: assetUrl,
  darkLogoUrl: assetUrl,
  accentColor: colorSchema,
  pageBackground: colorSchema,
  contentBackground: colorSchema,
  textColor: colorSchema,
  fontFamily: z.string().min(1).max(300),
  contentWidth: z.coerce.number().int().min(320).max(800),
  radius: z.coerce.number().int().min(0).max(48),
  alignment: z.enum(["left", "center"]),
  companyName: z.string().max(200),
  address: z.string().max(500),
  supportContact: z.string().max(320),
  footerText: z.string().max(1000),
});
const templateSchema = z.object({
  locale: localeSchema,
  enabled: z.boolean(),
  senderName: z.string().max(120),
  replyToPolicy: z.enum(["global", "none"]),
  subject: z.string().min(1).max(500).refine((value) => !/[\r\n]/.test(value), "Subject cannot contain line breaks"),
  preheader: z.string().max(500),
  html: z.string().min(1).max(200_000),
  text: z.string().min(1).max(100_000),
  publish: z.boolean().default(false),
});

async function isConfiguredLocale(id: string, locale: string): Promise<boolean> {
  return (await listLanguages(id, true)).some((language) => language.code === locale);
}

/* --------------------------------- trash -------------------------------- */

router.get("/trash", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "content:delete"))) return;
  try {
    sendJson(req, res, { items: await listTrash(siteId(req)) });
  } catch (err) {
    sendServerError(res, "manage.trash", err);
  }
});

router.post("/trash/restore", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "content:delete"))) return;
  const body = TrashBulk.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid trash items");
  const restored: string[] = [];
  const conflicts: Array<{ id: string; error: string }> = [];
  for (const item of body.data.items) {
    try {
      await restoreTrashItem(siteId(req), item.type, item.id);
      restored.push(item.id);
      auditFromRequest(req, "trash.restored", { target: item.id, detail: `type=${item.type}; bulk=true` });
    } catch (err) {
      conflicts.push({ id: item.id, error: err instanceof Error ? err.message : "Could not restore" });
    }
  }
  await invalidatePublicPages();
  res.status(conflicts.length ? 207 : 200).json({ restored, conflicts });
});

router.delete("/trash", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "site:admin"))) return;
    const raw = (req.body ?? {}) as { items?: unknown; confirmReferenced?: unknown };
    const body = TrashBulk.safeParse({ items: raw.items });
    if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid trash items");
    try {
      const id = siteId(req);
      const trash = await listTrash(id);
      const requested = new Set(body.data.items.map((item) => `${item.type}:${item.id}`));
      const selected = trash.filter((item) => requested.has(`${item.type}:${item.id}`));
      const referenced = selected.filter((item) => item.type === "media" && item.referenced);
      const confirm = raw.confirmReferenced === true || req.query.confirmReferenced === "true";
      if (referenced.length && !confirm) {
      res.status(409).json({ error: `${referenced.length} media item(s) are still referenced`, referenced: true });
      return;
    }
    for (const item of selected) await purgeTrashItem(id, item.type, item.id, true);
    await invalidatePublicPages();
    auditFromRequest(req, "trash.purged", { detail: `count=${selected.length}; bulk=true` });
    res.json({ ok: true, deleted: selected.length });
  } catch (err) {
    sendServerError(res, "manage.trash", err);
  }
});

/* ------------------------------- analytics ------------------------------ */

router.get("/analytics", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "analytics:read"))) return;
  try {
    sendJson(req, res, await getAnalyticsSummary(siteId(req)));
  } catch (err) {
    sendServerError(res, "manage.analytics", err);
  }
});

/* ---------------------------- comment rules ----------------------------- */

router.get("/comment-rules", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "comments:moderate"))) return;
  try {
    sendJson(req, res, { rules: await listRules(siteId(req)) });
  } catch (err) {
    sendServerError(res, "manage.comment-rules", err);
  }
});

router.post("/comment-rules", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  const body = RuleSchema.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid rule");
  try {
    const rule = await addRule(actorOf(req), body.data);
    res.status(201).json(rule);
  } catch (err) {
    sendServerError(res, "manage.comment-rules", err);
  }
});

router.delete("/comment-rules/:id", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  try {
    const ok = await removeRule(actorOf(req), param(req.params.id));
    if (!ok) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, "manage.comment-rules", err);
  }
});

router.get("/comment-spam-terms", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "comments:moderate"))) return;
  try {
    sendJson(req, res, { terms: await listSpamTerms(siteId(req)) });
  } catch (err) {
    sendServerError(res, "manage.comment-rules", err);
  }
});

router.post("/comment-spam-terms", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  const body = SpamTermSchema.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid term");
  try {
    const term = await addSpamTerm(actorOf(req), body.data);
    res.status(201).json(term);
  } catch (err) {
    sendServerError(res, "manage.comment-rules", err);
  }
});

router.delete("/comment-spam-terms/:id", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  try {
    const ok = await removeSpamTerm(actorOf(req), param(req.params.id));
    if (!ok) {
      res.status(404).json({ error: "Term not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, "manage.comment-rules", err);
  }
});

/* -------------------------------- cookies ------------------------------- */

router.get("/cookies", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:read"))) return;
  try {
    const id = siteId(req);
    const [cookies, overrides] = await Promise.all([getResolvedCookieRegistry(id), getCookieOverrides(id)]);
    sendJson(req, res, { cookies, overrides });
  } catch (err) {
    sendServerError(res, "manage.cookies", err);
  }
});

router.put("/cookies", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  const overrides = (req.body as { overrides?: Record<string, unknown> } | null)?.overrides;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return badRequest(res, "overrides must be an object of cookie name to category");
  }
  try {
    const id = siteId(req);
    const stored = await setCookieOverrides(id, overrides);
    const cookies = await getResolvedCookieRegistry(id);
    res.json({ cookies, overrides: stored });
  } catch (err) {
    sendServerError(res, "manage.cookies", err);
  }
});

/* ---------------------------- email templates --------------------------- */

router.get("/email-templates", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "email-templates:read"))) return;
  try {
    const id = siteId(req);
    const languages = await listLanguages(id, true);
    const parsed = localeSchema.safeParse(req.query.locale);
    const locale =
      parsed.success && languages.some((language) => language.code === parsed.data)
        ? parsed.data
        : await getDefaultLocale(id);
    sendJson(req, res, {
      locale,
      languages,
      templates: await listManagedEmailTemplates(id, locale),
      design: await getEmailDesign(id),
    });
  } catch (err) {
    sendServerError(res, "manage.emails", err);
  }
});

router.put("/email-templates/design", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "email-templates:manage"))) return;
  const body = z.object({ design: designSchema, publish: z.boolean().default(false) }).safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid design");
  try {
    const version = await saveEmailDesign(siteId(req), body.data.design, req.apiKeyOwner!.userId, body.data.publish);
    auditFromRequest(req, body.data.publish ? "email.design_published" : "email.design_saved", {
      target: `design:v${version}`,
    });
    res.json({ ok: true, version, status: body.data.publish ? "published" : "draft" });
  } catch (err) {
    sendServerError(res, "manage.emails", err);
  }
});

router.post("/email-templates/design/restore", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "email-templates:manage"))) return;
  try {
    const version = await saveEmailDesign(siteId(req), DEFAULT_EMAIL_DESIGN, req.apiKeyOwner!.userId, false);
    auditFromRequest(req, "email.design_restored", { target: `design:v${version}` });
    res.json({ ok: true, version, design: DEFAULT_EMAIL_DESIGN });
  } catch (err) {
    sendServerError(res, "manage.emails", err);
  }
});

router.put("/email-templates/:key", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "email-templates:manage"))) return;
  const key = param(req.params.key).slice(0, 160);
  const body = templateSchema.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid template");
  try {
    const id = siteId(req);
    if (!(await isConfiguredLocale(id, body.data.locale))) {
      return badRequest(res, "Select an active language configured under Admin → Languages");
    }
    const definition = listEmailTemplateDefinitions().find((item) => item.key === key);
    if (!definition) {
      res.status(404).json({ error: "Email template not found" });
      return;
    }
    if (!body.data.enabled && !definition.disableSafe) {
      return badRequest(res, "Security and account templates cannot be disabled");
    }
    const check = renderEmailSource({
      key,
      values: previewValues(definition),
      source: {
        subject: body.data.subject,
        preheader: body.data.preheader,
        html: body.data.html,
        text: body.data.text,
      },
      design: (await getEmailDesign(id)).design,
    });
    if (body.data.publish && check.errors.length) {
      res.status(400).json({ error: check.errors[0], errors: check.errors });
      return;
    }
    const version = await saveEmailTemplate(id, key, body.data.locale, body.data, req.apiKeyOwner!.userId, body.data.publish);
    auditFromRequest(req, body.data.publish ? "email.template_published" : "email.template_saved", {
      target: `${key}:${body.data.locale}:v${version}`,
    });
    res.json({ ok: true, version, status: body.data.publish ? "published" : "draft" });
  } catch (err) {
    sendServerError(res, "manage.emails", err);
  }
});

router.post("/email-templates/:key/restore", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "email-templates:manage"))) return;
  const key = param(req.params.key).slice(0, 160);
  const locale = localeSchema.safeParse((req.body as { locale?: unknown } | null)?.locale);
  if (!locale.success) return badRequest(res, locale.error.issues[0]?.message ?? "Invalid request");
  try {
    const id = siteId(req);
    if (!(await isConfiguredLocale(id, locale.data))) {
      return badRequest(res, "Select an active language configured under Admin → Languages");
    }
    const definition = listEmailTemplateDefinitions().find((item) => item.key === key);
    if (!definition) {
      res.status(404).json({ error: "Email template not found" });
      return;
    }
    const defaults = defaultEmailTemplateContent(definition, locale.data);
    const version = await saveEmailTemplate(
      id,
      key,
      locale.data,
      {
        enabled: true,
        senderName: "",
        replyToPolicy: "global",
        subject: defaults.subject,
        preheader: defaults.preheader,
        html: defaults.html,
        text: defaults.text,
      },
      req.apiKeyOwner!.userId,
      false,
    );
    auditFromRequest(req, "email.template_restored", { target: `${key}:${locale.data}:v${version}` });
    res.json({ ok: true, version });
  } catch (err) {
    sendServerError(res, "manage.emails", err);
  }
});

router.post("/email-templates/:key/preview", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "email-templates:read"))) return;
  const key = param(req.params.key).slice(0, 160);
  const body = z
    .object({
      locale: localeSchema.optional(),
      values: z.record(z.string(), z.string().max(4000)).optional(),
      mode: z.enum(["draft", "published"]).default("draft"),
    })
    .safeParse(req.body ?? {});
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid preview");
  try {
    const id = siteId(req);
    const definition = listEmailTemplateDefinitions().find((item) => item.key === key);
    if (!definition) {
      res.status(404).json({ error: "Email template not found" });
      return;
    }
    if (body.data.locale && !(await isConfiguredLocale(id, body.data.locale))) {
      return badRequest(res, "Select an active language configured under Admin → Languages");
    }
    const values = { ...previewValues(definition), ...body.data.values };
    sendJson(
      req,
      res,
      await renderEmailTemplate({ siteId: id, key, locale: body.data.locale, values, mode: body.data.mode }),
    );
  } catch (err) {
    sendServerError(res, "manage.emails", err);
  }
});

export default router;
