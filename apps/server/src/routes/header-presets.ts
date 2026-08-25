// SPDX-License-Identifier: MIT

import { Router } from "express";
import { z } from "zod";
import {
  deleteHeaderPreset,
  listHeaderPresets,
  saveHeaderPreset,
} from "../lib/header-presets.js";
import { getSiteId } from "../lib/themes-db.js";
import { requireRole } from "../middleware/auth.js";
import { CONTENT_READ_ROLES, THEME_CUSTOMIZE_ROLES } from "../lib/rbac.js";
import { param } from "../lib/params.js";

const router = Router();

const SaveSchema = z.object({
  name: z.string().max(120).optional(),
  header: z.record(z.string(), z.unknown()),
});

router.get("/", requireRole(...CONTENT_READ_ROLES), async (_req, res) => {
  const siteId = await getSiteId();
  if (!siteId) {
    res.json({ items: [] });
    return;
  }
  res.json({ items: await listHeaderPresets(siteId) });
});

router.put("/", requireRole(...THEME_CUSTOMIZE_ROLES), async (req, res) => {
  try {
    const body = SaveSchema.parse(req.body);
    const siteId = await getSiteId();
    if (!siteId) {
      res.status(503).json({ error: "No site found" });
      return;
    }
    const item = await saveHeaderPreset(siteId, body);
    res.json({ item });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not save" });
  }
});

router.delete("/:id", requireRole(...THEME_CUSTOMIZE_ROLES), async (req, res) => {
  const siteId = await getSiteId();
  if (!siteId) {
    res.status(503).json({ error: "No site found" });
    return;
  }
  await deleteHeaderPreset(siteId, param(req.params.id));
  res.json({ ok: true });
});

export default router;
