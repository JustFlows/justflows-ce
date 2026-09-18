// SPDX-License-Identifier: MIT

import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../../middleware/auth.js";
import { CONTENT_READ_ROLES, THEME_CUSTOMIZE_ROLES } from "../../lib/auth/rbac.js";
import { getActiveTheme, getSiteId, themeInstalledPath } from "../../lib/themes/themes-db.js";
import { listTemplateSlots } from "../../lib/themes/theme-templates-store.js";
import {
  ErrorPageConfigSchema,
  getErrorPageConfig,
  listErrorPagePickerOptions,
  PICKER_ERROR_CLASSES,
  setErrorPageConfig,
} from "../../lib/rendering/error-pages.js";

const router = Router();

async function activeTheme(): Promise<{
  siteId: string;
  themeId: string;
  installedPath: string | null;
} | null> {
  const siteId = await getSiteId();
  if (!siteId) return null;
  const theme = await getActiveTheme(siteId);
  return {
    siteId,
    themeId: theme?.theme_id ?? "justflows.default",
    installedPath: theme ? themeInstalledPath(theme) : null,
  };
}

router.get("/", requireRole(...CONTENT_READ_ROLES), async (_req, res) => {
  const ctx = await activeTheme();
  if (!ctx) {
    res.json({ config: {}, themeSlots: [], pages: [] });
    return;
  }
  const config = await getErrorPageConfig(ctx.siteId);
  const slots = await listTemplateSlots(ctx.siteId, ctx.themeId, ctx.installedPath);
  const themeSlots = slots
    .filter((slot) => (PICKER_ERROR_CLASSES as readonly string[]).includes(slot.slug) || slot.slug === "error")
    .map((slot) => slot.slug);
  const pages = await listErrorPagePickerOptions(ctx.siteId);
  res.json({ config, themeSlots, pages });
});

router.put("/", requireRole(...THEME_CUSTOMIZE_ROLES), async (req, res) => {
  try {
    const siteId = await getSiteId();
    if (!siteId) {
      res.status(503).json({ error: "No site found" });
      return;
    }
    const patch = ErrorPageConfigSchema.parse(req.body);
    const config = await setErrorPageConfig(siteId, patch);
    res.json({ ok: true, config });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0]?.message ?? "Invalid error page settings" });
      return;
    }
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not save" });
  }
});

export default router;
