// SPDX-License-Identifier: MIT

import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../middleware/auth.js";
import { sendServerError } from "../lib/send-error.js";
import {
  createWebhook,
  deleteWebhook,
  listWebhookDeliveries,
  listWebhookEventTypes,
  listWebhooks,
  redeliverWebhook,
  rotateWebhookSecret,
  updateWebhook,
} from "../lib/webhooks.js";

const router = Router();
const EventSchema = z.string().regex(/^[a-z][a-z0-9_.:-]{1,159}$/i);
const WebhookSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(2048),
  events: z.array(EventSchema).min(1).max(100),
  active: z.boolean().optional(),
});
const IdSchema = z.string().uuid();

router.use(requireRole("administrator"));

router.get("/", async (req, res) => {
  try {
    res.json({
      endpoints: await listWebhooks(req.session!.siteId),
      eventTypes: await listWebhookEventTypes(),
    });
  } catch (err) {
    sendServerError(res, "webhooks", err);
  }
});

router.post("/", async (req, res) => {
  const parsed = WebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid webhook" });
    return;
  }
  try {
    res.status(201).json(await createWebhook(req.session!.siteId, parsed.data));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid webhook" });
  }
});

router.put("/:id", async (req, res) => {
  const id = IdSchema.safeParse(req.params.id);
  const body = WebhookSchema.safeParse(req.body);
  if (!id.success || !body.success) {
    res.status(400).json({ error: "Invalid webhook" });
    return;
  }
  try {
    const value = await updateWebhook(req.session!.siteId, id.data, {
      ...body.data,
      active: body.data.active ?? true,
    });
    if (!value) {
      res.status(404).json({ error: "Webhook not found" });
      return;
    }
    res.json({ endpoint: value });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid webhook" });
  }
});

router.delete("/:id", async (req, res) => {
  const id = IdSchema.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: "Invalid webhook id" });
    return;
  }
  try {
    await deleteWebhook(req.session!.siteId, id.data);
    res.status(204).end();
  } catch (err) {
    sendServerError(res, "webhooks", err);
  }
});

router.post("/:id/rotate-secret", async (req, res) => {
  const id = IdSchema.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: "Invalid webhook id" });
    return;
  }
  try {
    const secret = await rotateWebhookSecret(req.session!.siteId, id.data);
    if (!secret) {
      res.status(404).json({ error: "Webhook not found" });
      return;
    }
    res.json({ secret });
  } catch (err) {
    sendServerError(res, "webhooks", err);
  }
});

router.get("/deliveries/history", async (req, res) => {
  const endpointId =
    typeof req.query.endpointId === "string" ? IdSchema.safeParse(req.query.endpointId) : null;
  if (endpointId && !endpointId.success) {
    res.status(400).json({ error: "Invalid endpoint id" });
    return;
  }
  try {
    res.json({ deliveries: await listWebhookDeliveries(req.session!.siteId, endpointId?.data) });
  } catch (err) {
    sendServerError(res, "webhooks", err);
  }
});

router.post("/deliveries/:id/redeliver", async (req, res) => {
  const id = IdSchema.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: "Invalid delivery id" });
    return;
  }
  try {
    if (!(await redeliverWebhook(req.session!.siteId, id.data))) {
      res.status(404).json({ error: "Delivery not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, "webhooks", err);
  }
});

export default router;
