// SPDX-License-Identifier: MIT

import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../middleware/auth.js";
import { auditFromRequest } from "../lib/audit-log.js";
import { listTrash, purgeTrashItem, restoreTrashItem } from "../lib/trash.js";
import { invalidatePublicPages } from "../lib/public-cache.js";
import { param } from "../lib/params.js";

const router = Router();
const TypeSchema = z.enum(["content", "media", "comment", "menu"]);
const BulkSchema = z.object({
  items: z
    .array(z.object({ type: TypeSchema, id: z.string().uuid() }))
    .min(1)
    .max(200),
});

router.get("/", requireRole("administrator", "editor"), async (req, res) => {
  res.json({ items: await listTrash(req.session!.siteId) });
});

router.post("/restore", requireRole("administrator", "editor"), async (req, res) => {
  const parsed = BulkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }
  const restored: string[] = [];
  const conflicts: Array<{ id: string; error: string }> = [];
  for (const item of parsed.data.items) {
    try {
      await restoreTrashItem(req.session!.siteId, item.type, item.id);
      restored.push(item.id);
      auditFromRequest(req, "trash.restored", {
        target: item.id,
        detail: `type=${item.type}; bulk=true`,
      });
    } catch (err) {
      conflicts.push({ id: item.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  await invalidatePublicPages();
  res.status(conflicts.length ? 207 : 200).json({ restored, conflicts });
});

router.delete("/bulk", requireRole("administrator"), async (req, res) => {
  const parsed = BulkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }
  const trash = await listTrash(req.session!.siteId);
  const requested = new Set(parsed.data.items.map((item) => `${item.type}:${item.id}`));
  const selected = trash.filter((item) => requested.has(`${item.type}:${item.id}`));
  const referenced = selected.filter((item) => item.type === "media" && item.referenced);
  if (referenced.length && req.query.confirmReferenced !== "true") {
    res
      .status(409)
      .json({ error: `${referenced.length} media item(s) are still referenced`, referenced: true });
    return;
  }
  for (const item of selected) await purgeTrashItem(req.session!.siteId, item.type, item.id, true);
  await invalidatePublicPages();
  auditFromRequest(req, "trash.purged", { detail: `count=${selected.length}; bulk=true` });
  res.json({ ok: true, deleted: selected.length });
});

router.post("/:type/:id/restore", requireRole("administrator", "editor"), async (req, res) => {
  const parsed = TypeSchema.safeParse(param(req.params.type));
  if (!parsed.success) {
    res.status(400).json({ error: "Unknown trash type" });
    return;
  }
  try {
    await restoreTrashItem(req.session!.siteId, parsed.data, param(req.params.id));
    await invalidatePublicPages();
    auditFromRequest(req, "trash.restored", {
      target: param(req.params.id),
      detail: `type=${parsed.data}`,
    });
    res.json({ ok: true });
  } catch (err) {
    res
      .status(String(err).includes("already in use") ? 409 : 404)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.delete("/:type/:id", requireRole("administrator"), async (req, res) => {
  const parsed = TypeSchema.safeParse(param(req.params.type));
  if (!parsed.success) {
    res.status(400).json({ error: "Unknown trash type" });
    return;
  }
  try {
    await purgeTrashItem(
      req.session!.siteId,
      parsed.data,
      param(req.params.id),
      req.query.confirmReferenced === "true",
    );
    await invalidatePublicPages();
    auditFromRequest(req, "trash.purged", {
      target: param(req.params.id),
      detail: `type=${parsed.data}`,
    });
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res
      .status(message.includes("still referenced") ? 409 : 404)
      .json({ error: message, referenced: message.includes("still referenced") });
  }
});

router.delete("/", requireRole("administrator"), async (req, res) => {
  const items = await listTrash(req.session!.siteId);
  const referenced = items.filter((item) => item.type === "media" && item.referenced);
  if (referenced.length && req.query.confirmReferenced !== "true") {
    res
      .status(409)
      .json({ error: `${referenced.length} media item(s) are still referenced`, referenced: true });
    return;
  }
  for (const item of items) await purgeTrashItem(req.session!.siteId, item.type, item.id, true);
  await invalidatePublicPages();
  auditFromRequest(req, "trash.emptied", { detail: `count=${items.length}` });
  res.json({ ok: true, deleted: items.length });
});

export default router;
