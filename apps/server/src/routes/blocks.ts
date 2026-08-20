import { Router } from "express";
import { getRuntimeBlockRegistry } from "../lib/runtime-blocks.js";
import { isFormsPluginEnabled, registerFormsBlock } from "../lib/forms-public.js";
import { isGalleryPluginEnabled, registerGalleryBlock } from "../lib/gallery-public.js";

const router = Router();

/** List registered block types for the page builder. */
router.get("/", async (_req, res) => {
  if (await isFormsPluginEnabled()) registerFormsBlock();
  if (await isGalleryPluginEnabled()) registerGalleryBlock();
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
