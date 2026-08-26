import { Router } from "express";
import { requireRole } from "../middleware/auth.js";
import { CONTENT_READ_ROLES } from "../lib/rbac.js";
import { getRuntimeBlockRegistry } from "../lib/runtime-blocks.js";
import { isFormsPluginEnabled, registerFormsBlock, unregisterFormsBlock } from "../lib/forms-public.js";
import { isGalleryPluginEnabled, registerGalleryBlock, unregisterGalleryBlock } from "../lib/gallery-public.js";

const router = Router();

/**
 * List registered block types for the page builder.
 *
 * Guarded: the only caller is the builder, and the response enumerates every
 * plugin-contributed block type and version — a precise inventory of which
 * extensions a site runs, which is the first thing worth knowing before
 * choosing an exploit. Each call also runs two plugin-status queries, so
 * leaving it open made it a free amplification target as well.
 */
router.get("/", requireRole(...CONTENT_READ_ROLES), async (_req, res) => {
  if (await isFormsPluginEnabled()) registerFormsBlock();
  else unregisterFormsBlock();
  if (await isGalleryPluginEnabled()) registerGalleryBlock();
  else unregisterGalleryBlock();
  const blocks = getRuntimeBlockRegistry().list().map((def) => ({
    type: def.type,
    version: def.version,
    title: def.title,
    description: def.description,
    icon: def.icon,
    category: def.category ?? "content",
    schema: def.schema,
    supportsChildren: def.supportsChildren ?? false,
    allowedChildTypes: def.allowedChildTypes,
  }));
  res.json({ blocks });
});

export default router;
