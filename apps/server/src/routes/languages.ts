import { Router } from "express";
import { z } from "zod";
import {
  addLanguage,
  deleteLanguage,
  ensureDefaultLanguages,
  listLanguages,
  setDefaultLanguage,
  updateLanguage,
} from "../lib/i18n/languages-db.js";
import { requireRole, requireSession } from "../middleware/auth.js";
import { setLocaleCookie, LOCALE_COOKIE } from "../middleware/locale.js";
import { param } from "../lib/params.js";
import { sendServerError } from "../lib/send-error.js";

const router = Router();

router.get("/", requireSession, async (_req, res) => {
  try {
    const languages = await listLanguages();
    res.json({ languages });
  } catch (err) {
    sendServerError(res, "languages", err);
  }
});

router.get("/active", requireSession, async (_req, res) => {
  try {
    const languages = await listLanguages(undefined, true);
    res.json({ languages });
  } catch (err) {
    sendServerError(res, "languages", err);
  }
});

const AddSchema = z.object({
  code: z.string().min(2).max(20),
  name: z.string().optional(),
  nativeName: z.string().optional(),
});

router.post("/", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  const body = AddSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message });
    return;
  }

  try {
    await ensureDefaultLanguages(session.siteId);
    const language = await addLanguage(session.siteId, body.data);
    res.status(201).json({ language });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

router.post("/:id/default", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  try {
    await setDefaultLanguage(session.siteId, param(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

router.patch("/:id", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  const patch = z
    .object({
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
      name: z.string().optional(),
      nativeName: z.string().optional(),
    })
    .parse(req.body);

  try {
    await updateLanguage(session.siteId, param(req.params.id), patch);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

router.delete("/:id", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  try {
    await deleteLanguage(session.siteId, param(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Set visitor/admin UI locale preference cookie. */
router.post("/preference", requireSession, async (req, res) => {
  const code = z.object({ locale: z.string() }).parse(req.body).locale;
  setLocaleCookie(res, code);
  res.json({ ok: true, locale: code });
});

export default router;

export { serveAdminI18n } from "../lib/i18n/admin-catalog.js";

export { LOCALE_COOKIE };
