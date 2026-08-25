// SPDX-License-Identifier: MIT

import { Router } from "express";
import { z } from "zod";
import {
  deleteReusableBlock,
  listReusableBlocks,
  saveReusableBlock,
} from "../lib/reusable-blocks.js";
import { getSiteId } from "../lib/themes-db.js";
import { revalidateOnUpdate } from "../lib/cache-revalidate.js";
import { requireRole } from "../middleware/auth.js";
import { CONTENT_READ_ROLES, THEME_CUSTOMIZE_ROLES } from "../lib/rbac.js";
import { param } from "../lib/params.js";
import {
  getTemplatePart,
  isTemplatePart,
  saveTemplatePart,
} from "../lib/template-parts.js";

const router = Router();

const SaveSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().max(120).optional(),
  blocks: z.array(z.record(z.string(), z.unknown())),
});

router.get("/", requireRole(...CONTENT_READ_ROLES), async (_req, res) => {
  const siteId = await getSiteId();
  if (!siteId) {
    res.json({ items: [] });
    return;
  }
  res.json({ items: await listReusableBlocks(siteId) });
});

router.put("/", requireRole(...THEME_CUSTOMIZE_ROLES), async (req, res) => {
  try {
    const body = SaveSchema.parse(req.body);
    const siteId = await getSiteId();
    if (!siteId) {
      res.status(503).json({ error: "No site found" });
      return;
    }
    const item = await saveReusableBlock(siteId, body);
    // Every page using this block now renders differently.
    await revalidateOnUpdate("content");
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
  await deleteReusableBlock(siteId, param(req.params.id));
  await revalidateOnUpdate("content");
  res.json({ ok: true });
});

export default router;

// ─── Template parts ────────────────────────────────────────────────────────
//
// Site-wide chrome edited as blocks. Mounted here rather than in its own file
// because it shares the same storage shape and the same cache invalidation.

export const templatePartsRouter = Router();

const PartSchema = z.object({
  blocks: z.array(z.record(z.string(), z.unknown())),
  draft: z.boolean().default(false),
});

templatePartsRouter.get("/:part", requireRole(...CONTENT_READ_ROLES), async (req, res) => {
  const part = param(req.params.part);
  if (!isTemplatePart(part)) {
    res.status(404).json({ error: "Unknown template part" });
    return;
  }
  const siteId = await getSiteId();
  if (!siteId) {
    res.json({ blocks: [], draft: [] });
    return;
  }
  res.json({
    blocks: await getTemplatePart(siteId, part, false),
    draft: await getTemplatePart(siteId, part, true),
  });
});

templatePartsRouter.put("/:part", requireRole(...THEME_CUSTOMIZE_ROLES), async (req, res) => {
  try {
    const part = param(req.params.part);
    if (!isTemplatePart(part)) {
      res.status(404).json({ error: "Unknown template part" });
      return;
    }
    const body = PartSchema.parse(req.body);
    const siteId = await getSiteId();
    if (!siteId) {
      res.status(503).json({ error: "No site found" });
      return;
    }
    const blocks = await saveTemplatePart(siteId, part, body.blocks, body.draft);
    if (!body.draft) await revalidateOnUpdate("theme");
    res.json({ blocks });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not save" });
  }
});
