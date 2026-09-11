// SPDX-License-Identifier: MIT

import { Router } from "express";
import { z } from "zod";
import {
  createMenu,
  deleteMenu,
  getEffectiveMenuDesign,
  getEffectiveMenuItems,
  getMenuBySlug,
  listMenus,
  updateMenu,
} from "../../lib/menus-db.js";
import {
  createContentType,
  deleteContentType,
  getContentTypeBySlug,
  listContentTypes,
  updateContentType,
} from "../../lib/content-types-db.js";
import {
  addLanguage,
  deleteLanguage,
  listLanguages,
  setDefaultLanguageByCode,
  updateLanguage,
} from "../../lib/i18n/languages-db.js";
import { listRedirects, saveRedirects } from "../../lib/redirects-db.js";
import { RedirectValidationError, validateRedirect } from "../../lib/redirects.js";
import { auditLog } from "../../lib/audit-log.js";
import { clientIp } from "../../lib/rate-limit.js";
import { sendServerError } from "../../lib/send-error.js";
import { badRequest, ensureKeyCan, notFound, paginate, relay, sendJson } from "./envelope.js";
import type { Request, Response } from "express";

const router = Router();

function auditSettings(req: Request, detail: string): void {
  void auditLog({
    siteId: req.apiKeyOwner!.siteId,
    action: "settings.changed",
    actorId: req.apiKeyOwner!.userId,
    actorRole: "api-key",
    ip: clientIp(req),
    userAgent: req.get("user-agent") ?? null,
    detail,
  });
}

/* ------------------------------- menus ---------------------------------- */

router.get("/menus", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "content:read"))) return;
  try {
    sendJson(req, res, paginate(await listMenus(req.apiKeyOwner!.siteId), req));
  } catch (err) {
    sendServerError(res, "manage.menus", err);
  }
});

router.get("/menus/:slug", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "content:read"))) return;
  try {
    const menu = await getMenuBySlug(req.apiKeyOwner!.siteId, req.params.slug);
    if (!menu) return notFound(res, "Menu not found");
    sendJson(req, res, {
      menu: {
        ...menu,
        items: getEffectiveMenuItems(menu, false),
        design: getEffectiveMenuDesign(menu, false),
      },
    });
  } catch (err) {
    sendServerError(res, "manage.menus", err);
  }
});

const MenuCreateSchema = z.object({
  slug: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
});

router.post("/menus", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  const body = MenuCreateSchema.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid menu");
  try {
    const menu = await createMenu(req.apiKeyOwner!.siteId, body.data.slug, body.data.name);
    auditSettings(req, `menu.created:${body.data.slug}`);
    res.status(201).json({ menu });
  } catch (err) {
    sendServerError(res, "manage.menus", err);
  }
});

router.put("/menus/:slug", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  try {
    const menu = await updateMenu(req.apiKeyOwner!.siteId, req.params.slug, req.body ?? {});
    if (!menu) return notFound(res, "Menu not found");
    auditSettings(req, `menu.updated:${req.params.slug}`);
    res.json({ menu });
  } catch (err) {
    if (err instanceof Error && /invalid|exceeds|depth/i.test(err.message)) {
      return badRequest(res, err.message);
    }
    sendServerError(res, "manage.menus", err);
  }
});

router.delete("/menus/:slug", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  try {
    const removed = await deleteMenu(req.apiKeyOwner!.siteId, req.params.slug, req.apiKeyOwner!.userId);
    if (!removed) return notFound(res, "Menu not found");
    auditSettings(req, `menu.deleted:${req.params.slug}`);
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, "manage.menus", err);
  }
});

/* --------------------------- content types ----------------------------- */

router.get("/content-types", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "content:read"))) return;
  try {
    sendJson(req, res, { types: await listContentTypes(req.apiKeyOwner!.siteId) });
  } catch (err) {
    sendServerError(res, "manage.content-types", err);
  }
});

router.get("/content-types/:slug", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "content:read"))) return;
  try {
    const type = await getContentTypeBySlug(req.params.slug, req.apiKeyOwner!.siteId);
    if (!type) return notFound(res, "Content type not found");
    sendJson(req, res, { type });
  } catch (err) {
    sendServerError(res, "manage.content-types", err);
  }
});

const ContentTypeSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]{0,59}$/),
  label: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional(),
});

function contentTypeError(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (/not found/i.test(message)) return notFound(res, message);
  if (/built-in|in use|Cannot/i.test(message)) return badRequest(res, message);
  sendServerError(res, "manage.content-types", err);
}

router.post("/content-types", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  const body = ContentTypeSchema.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid content type");
  try {
    const type = await createContentType(req.apiKeyOwner!.siteId, {
      slug: body.data.slug,
      label: body.data.label,
      description: body.data.description,
    });
    auditSettings(req, `content-type.created:${body.data.slug}`);
    res.status(201).json({ type });
  } catch (err) {
    contentTypeError(res, err);
  }
});

router.patch("/content-types/:slug", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  try {
    const type = await updateContentType(req.apiKeyOwner!.siteId, req.params.slug, req.body ?? {});
    auditSettings(req, `content-type.updated:${req.params.slug}`);
    res.json({ type });
  } catch (err) {
    contentTypeError(res, err);
  }
});

router.delete("/content-types/:slug", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  try {
    await deleteContentType(req.apiKeyOwner!.siteId, req.params.slug);
    auditSettings(req, `content-type.deleted:${req.params.slug}`);
    res.json({ ok: true });
  } catch (err) {
    contentTypeError(res, err);
  }
});

/* ----------------------------- languages ------------------------------- */

router.get("/languages", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:read"))) return;
  try {
    sendJson(req, res, { languages: await listLanguages(req.apiKeyOwner!.siteId) });
  } catch (err) {
    sendServerError(res, "manage.languages", err);
  }
});

const LanguageCreateSchema = z.object({
  code: z.string().min(2).max(20),
  name: z.string().max(120).optional(),
  nativeName: z.string().max(120).optional(),
});

router.post("/languages", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  const body = LanguageCreateSchema.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid language");
  try {
    const language = await addLanguage(req.apiKeyOwner!.siteId, body.data);
    auditSettings(req, `language.added:${body.data.code}`);
    res.status(201).json({ language });
  } catch (err) {
    return badRequest(res, err instanceof Error ? err.message : "Invalid language");
  }
});

const LanguagePatchSchema = z.object({
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  name: z.string().max(120).optional(),
  nativeName: z.string().max(120).optional(),
  makeDefault: z.boolean().optional(),
});

router.patch("/languages/:id", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  const body = LanguagePatchSchema.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid patch");
  try {
    await updateLanguage(req.apiKeyOwner!.siteId, req.params.id, body.data);
    if (body.data.makeDefault) {
      const langs = await listLanguages(req.apiKeyOwner!.siteId);
      const target = langs.find((l) => l.id === req.params.id);
      if (target) await setDefaultLanguageByCode(req.apiKeyOwner!.siteId, target.code);
    }
    auditSettings(req, `language.updated:${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    return badRequest(res, err instanceof Error ? err.message : "Invalid patch");
  }
});

router.delete("/languages/:id", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  try {
    await deleteLanguage(req.apiKeyOwner!.siteId, req.params.id);
    auditSettings(req, `language.deleted:${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not found/i.test(message)) return notFound(res, message);
    return badRequest(res, message);
  }
});

/* ----------------------------- redirects ------------------------------- */

router.get("/redirects", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:read"))) return;
  try {
    sendJson(req, res, paginate(await listRedirects(req.apiKeyOwner!.siteId), req));
  } catch (err) {
    sendServerError(res, "manage.redirects", err);
  }
});

router.post("/redirects", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  try {
    const [rule] = await saveRedirects(req.apiKeyOwner!.siteId, [validateRedirect(req.body)]);
    auditSettings(req, `redirect.created:${rule?.id ?? ""}`);
    res.status(201).json({ rule });
  } catch (err) {
    if (err instanceof RedirectValidationError) return badRequest(res, err.message);
    sendServerError(res, "manage.redirects", err);
  }
});

router.put("/redirects/:id", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  if (!z.string().uuid().safeParse(req.params.id).success) {
    return badRequest(res, "Invalid redirect ID.");
  }
  try {
    const [rule] = await saveRedirects(
      req.apiKeyOwner!.siteId,
      [validateRedirect(req.body)],
      req.params.id,
    );
    auditSettings(req, `redirect.updated:${req.params.id}`);
    res.json({ rule });
  } catch (err) {
    if (err instanceof RedirectValidationError) {
      return res
        .status(err.message === "Redirect not found." ? 404 : 400)
        .json({ error: err.message });
    }
    sendServerError(res, "manage.redirects", err);
  }
});

export default router;
