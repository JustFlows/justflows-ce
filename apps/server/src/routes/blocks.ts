import { Router } from "express";
import { getRuntimeBlockRegistry } from "../lib/runtime-blocks.js";
import { isFormsPluginEnabled, registerFormsBlock, unregisterFormsBlock } from "../lib/forms-public.js";
import { isGalleryPluginEnabled, registerGalleryBlock, unregisterGalleryBlock } from "../lib/gallery-public.js";

const router = Router();

/** List registered block types for the page builder. */
router.get("/", async (_req, res) => {
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
