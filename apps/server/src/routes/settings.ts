import { Router } from "express";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { getSiteId } from "../lib/site-settings.js";
import { revalidateOnUpdate } from "../lib/cache-revalidate.js";
import { requireCapability, requireRole, requireSession } from "../middleware/auth.js";
import { THEME_CUSTOMIZE_ROLES } from "../lib/rbac.js";
import { setHomePageId } from "../lib/home-page.js";
import { setBlogPageId } from "../lib/blog-page.js";
import {
  sendTestMail,
  listEmailDeliveries,
  retryEmailDelivery,
  addEmailSuppression,
  listEmailSuppressions,
  removeEmailSuppression,
} from "../lib/mail.js";
import { auditFromRequest } from "../lib/audit-log.js";
import { sendServerError } from "../lib/send-error.js";
import type { CommentSettings } from "../lib/comments-settings.js";

import { PermalinkSettingsSchema, PERMALINK_PRESETS } from "../lib/permalinks.js";
import { getPermalinkState, savePermalinks, PermalinkConflictError } from "../lib/permalinks-db.js";
import { listContentTypes } from "../lib/content-types-db.js";
import {
  applySettingsChange,
  getSettingsPayload,
  SettingsSchema,
} from "../lib/settings-admin.js";

const router = Router();
router.get("/permalinks", requireSession, requireRole("administrator"), async (req, res) => {
  try {
    const siteId = req.session!.siteId;
    const state = await getPermalinkState(siteId);
    const db = await getDb();
    const taxonomies = await db.query<{ slug: string; name: string }>("SELECT slug, name FROM taxonomies WHERE site_id = ? ORDER BY slug", [siteId]);
    res.json({ ...state, presets: PERMALINK_PRESETS, types: await listContentTypes(siteId), taxonomies });
  } catch (err) { sendServerError(res, "permalinks", err); }
});
router.put("/permalinks", requireSession, requireRole("administrator"), async (req, res) => {
  const parsed = PermalinkSettingsSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  try {
    const redirectsCreated = await savePermalinks(req.session!.siteId, parsed.data);
    auditFromRequest(req, "settings.changed", { detail: "permalinks" });
    res.json({ ok: true, redirectsCreated });
  } catch (err) {
    if (err instanceof PermalinkConflictError) { res.status(409).json({ error: err.message }); return; }
    sendServerError(res, "permalinks", err);
  }
});

router.get("/", requireSession, async (req, res) => {
  try {
    res.json(await getSettingsPayload({ isAdmin: req.session?.role === "administrator" }));
  } catch (e) {
    sendServerError(res, "settings", e);
  }
});

router.post("/", requireRole("administrator"), async (req, res) => {
  const body = SettingsSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid settings" });
    return;
  }
  try {
    const session = req.session!;
    const result = await applySettingsChange(body.data, {
      siteId: session.siteId,
      userId: session.userId,
      role: session.role,
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
    res.status(result.status).json(result.body);
  } catch (e) {
    sendServerError(res, "settings", e);
  }
});

const HomePageSchema = z.object({
  contentId: z.string().uuid().nullable(),
});

router.put("/home-page", requireRole(...THEME_CUSTOMIZE_ROLES), async (req, res) => {
  try {
    const siteId = await getSiteId();
    if (!siteId) {
      res.status(503).json({ error: "No site found" });
      return;
    }
    const body = HomePageSchema.parse(req.body);
    const homePageId = await setHomePageId(siteId, body.contentId);
    res.json({ ok: true, homePageId });
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: e.issues[0]?.message ?? "Invalid home page" });
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    const status = message === "Page not found" || message === "Home must be a page" ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

const BlogPageSchema = z.object({
  contentId: z.string().uuid().nullable(),
});

router.put("/blog-page", requireRole(...THEME_CUSTOMIZE_ROLES), async (req, res) => {
  try {
    const siteId = await getSiteId();
    if (!siteId) {
      res.status(503).json({ error: "No site found" });
      return;
    }
    const body = BlogPageSchema.parse(req.body);
    const blogPageId = await setBlogPageId(siteId, body.contentId);
    res.json({ ok: true, blogPageId });
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: e.issues[0]?.message ?? "Invalid blog page" });
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    const status =
      message === "Page not found" || message === "Blog page must be a page" ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

const CommentSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  requireModeration: z.boolean().optional(),
  closeAfterDays: z.coerce.number().int().min(0).max(3650).optional(),
  allowUrls: z.boolean().optional(),
  notifyModerator: z.boolean().optional(),
  maxLength: z.coerce.number().int().min(200).max(20_000).optional(),
  threadMaxDepth: z.coerce.number().int().min(1).max(10).optional(),
  pageSize: z.coerce.number().int().min(5).max(200).optional(),
  captchaProvider: z
    .enum(["none", "turnstile", "hcaptcha", "recaptcha", "recaptcha-v3"])
    .optional(),
  captchaSiteKey: z.string().max(200).optional(),
  captchaScoreThreshold: z.coerce.number().min(0).max(1).optional(),
  // Write-only. An empty string leaves the stored secret untouched.
  captchaSecretKey: z.string().max(200).optional(),
});

router.get("/comments", requireRole("administrator"), async (_req, res) => {
  try {
    const { getCommentSettings, toPublicCommentSettings } =
      await import("../lib/comments-settings.js");
    const siteId = await getSiteId();
    if (!siteId) {
      res.status(503).json({ error: "No site found" });
      return;
    }
    res.json(toPublicCommentSettings(await getCommentSettings(siteId)));
  } catch (e) {
    sendServerError(res, "settings", e);
  }
});

router.put("/comments", requireRole("administrator"), async (req, res) => {
  try {
    const siteId = await getSiteId();
    if (!siteId) {
      res.status(503).json({ error: "No site found" });
      return;
    }
    const body = CommentSettingsSchema.parse(req.body);
    const { saveCommentSettings, toPublicCommentSettings } =
      await import("../lib/comments-settings.js");
    const patch: Partial<CommentSettings> = { ...body };
    // An omitted or blank secret means "keep the current one".
    if (!body.captchaSecretKey) delete patch.captchaSecretKey;
    const saved = await saveCommentSettings(siteId, patch);
    auditFromRequest(req, "settings.changed", { detail: "comments" });
    await revalidateOnUpdate("settings");
    const { invalidatePublicPages } = await import("../lib/public-cache.js");
    await invalidatePublicPages();
    res.json(toPublicCommentSettings(saved));
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: e.issues[0]?.message ?? "Invalid comment settings" });
      return;
    }
    sendServerError(res, "settings", e);
  }
});

router.post("/test-mail", requireCapability("mail:manage"), async (_req, res) => {
  try {
    const result = await sendTestMail();
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json(result);
  } catch (e) {
    sendServerError(res, "settings", e);
  }
});

router.get("/email/logs", requireCapability("mail:read"), async (req, res) => {
  try {
    const siteId = await getSiteId();
    if (!siteId) return void res.status(503).json({ error: "No site found" });
    const status = z
      .enum(["queued", "sent", "deferred", "failed", "bounced"])
      .optional()
      .parse(
        typeof req.query.status === "string" && req.query.status ? req.query.status : undefined,
      );
    res.json({ deliveries: await listEmailDeliveries(siteId, status) });
  } catch (e) {
    if (e instanceof z.ZodError)
      return void res.status(400).json({ error: "Invalid email status" });
    sendServerError(res, "email logs", e);
  }
});

router.post("/email/logs/:id/retry", requireCapability("mail:manage"), async (req, res) => {
  try {
    const parsed = z.string().uuid().safeParse(req.params.id);
    if (!parsed.success) return void res.status(400).json({ error: "Invalid delivery id" });
    const siteId = await getSiteId();
    if (!siteId) return void res.status(503).json({ error: "No site found" });
    const result = await retryEmailDelivery(siteId, parsed.data);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    sendServerError(res, "email retry", e);
  }
});

const SuppressionSchema = z.object({
  email: z.string().email(),
  messageType: z.string().min(1).max(80).default("*"),
  reason: z.string().max(500).optional(),
});
router.get("/email/suppressions", requireCapability("mail:read"), async (_req, res) => {
  try {
    const siteId = await getSiteId();
    if (!siteId) return void res.status(503).json({ error: "No site found" });
    res.json({ suppressions: await listEmailSuppressions(siteId) });
  } catch (e) {
    sendServerError(res, "email suppressions", e);
  }
});
router.post("/email/suppressions", requireCapability("mail:manage"), async (req, res) => {
  try {
    const body = SuppressionSchema.parse(req.body);
    const siteId = await getSiteId();
    if (!siteId) return void res.status(503).json({ error: "No site found" });
    await addEmailSuppression(siteId, body.email, body.messageType, body.reason);
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError)
      return void res.status(400).json({ error: e.issues[0]?.message ?? "Invalid suppression" });
    sendServerError(res, "email suppression", e);
  }
});
router.delete("/email/suppressions/:id", requireCapability("mail:manage"), async (req, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const siteId = await getSiteId();
    if (!siteId) return void res.status(503).json({ error: "No site found" });
    await removeEmailSuppression(siteId, id);
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError)
      return void res.status(400).json({ error: "Invalid suppression id" });
    sendServerError(res, "email suppression", e);
  }
});

export default router;
