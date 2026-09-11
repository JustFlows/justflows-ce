// SPDX-License-Identifier: MIT

import { Router } from "express";
import { z } from "zod";
import { getDb } from "../../lib/db.js";
import { clientIp } from "../../lib/rate-limit.js";
import {
  createWebhook,
  deleteWebhook,
  listWebhookEventTypes,
  rotateWebhookSecret,
  updateWebhook,
} from "../../lib/webhooks.js";
import { auditLog } from "../../lib/audit-log.js";
import { sendServerError } from "../../lib/send-error.js";
import { badRequest, ensureKeyCan, notFound, sendJson } from "./envelope.js";

/**
 * A key with `settings:manage` manages the webhook endpoints it registered
 * itself — nothing else. Every row it creates is tagged with the key id
 * (`webhook_endpoints.api_key_id`) and list / update / delete are filtered to
 * that tag, so one integration cannot see or change another's subscriptions or
 * any an administrator wired by hand.
 */

const router = Router();

const EventSchema = z.string().regex(/^[a-z][a-z0-9_.:-]{1,159}$/i);
const WebhookSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(2048),
  events: z.array(EventSchema).min(1).max(100),
  active: z.boolean().optional(),
});
const IdSchema = z.string().uuid();

async function ownsEndpoint(siteId: string, keyId: string, id: string): Promise<boolean> {
  const rows = await (
    await getDb()
  ).query<{ id: string }>(
    "SELECT id FROM webhook_endpoints WHERE id = ? AND site_id = ? AND api_key_id = ? LIMIT 1",
    [id, siteId, keyId],
  );
  return Boolean(rows[0]);
}

router.get("/", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  try {
    const rows = await (
      await getDb()
    ).query<Record<string, unknown>>(
      "SELECT id, name, url, events, active, created_at, updated_at FROM webhook_endpoints WHERE site_id = ? AND api_key_id = ? ORDER BY created_at DESC",
      [req.apiKeyOwner!.siteId, req.apiKey!.id],
    );
    const endpoints = rows.map((r) => ({
      id: r.id,
      name: r.name,
      url: r.url,
      events: JSON.parse(String(r.events ?? "[]")) as string[],
      active: r.active === true || r.active === 1 || r.active === "1",
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    sendJson(req, res, { endpoints, eventTypes: await listWebhookEventTypes() });
  } catch (err) {
    sendServerError(res, "manage.webhooks", err);
  }
});

router.post("/", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  const body = WebhookSchema.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid webhook");
  try {
    const created = await createWebhook(req.apiKeyOwner!.siteId, body.data);
    await (
      await getDb()
    ).run("UPDATE webhook_endpoints SET api_key_id = ? WHERE id = ? AND site_id = ?", [
      req.apiKey!.id,
      created.endpoint.id,
      req.apiKeyOwner!.siteId,
    ]);
    void auditLog({
      siteId: req.apiKeyOwner!.siteId,
      action: "settings.changed",
      actorId: req.apiKeyOwner!.userId,
      actorRole: "api-key",
      ip: clientIp(req),
      target: created.endpoint.id,
      detail: `webhook.self_registered by key ${req.apiKey!.id}`,
    });
    res.status(201).json(created);
  } catch (err) {
    return badRequest(res, err instanceof Error ? err.message : "Invalid webhook");
  }
});

router.put("/:id", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  const id = IdSchema.safeParse(req.params.id);
  const body = WebhookSchema.safeParse(req.body);
  if (!id.success || !body.success) return badRequest(res, "Invalid webhook");
  try {
    if (!(await ownsEndpoint(req.apiKeyOwner!.siteId, req.apiKey!.id, id.data))) {
      return notFound(res, "Webhook not found");
    }
    const value = await updateWebhook(req.apiKeyOwner!.siteId, id.data, {
      ...body.data,
      active: body.data.active ?? true,
    });
    if (!value) return notFound(res, "Webhook not found");
    res.json({ endpoint: value });
  } catch (err) {
    return badRequest(res, err instanceof Error ? err.message : "Invalid webhook");
  }
});

router.post("/:id/rotate-secret", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  const id = IdSchema.safeParse(req.params.id);
  if (!id.success) return badRequest(res, "Invalid webhook id");
  try {
    if (!(await ownsEndpoint(req.apiKeyOwner!.siteId, req.apiKey!.id, id.data))) {
      return notFound(res, "Webhook not found");
    }
    const secret = await rotateWebhookSecret(req.apiKeyOwner!.siteId, id.data);
    if (!secret) return notFound(res, "Webhook not found");
    res.json({ secret });
  } catch (err) {
    sendServerError(res, "manage.webhooks", err);
  }
});

router.delete("/:id", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  const id = IdSchema.safeParse(req.params.id);
  if (!id.success) return badRequest(res, "Invalid webhook id");
  try {
    if (!(await ownsEndpoint(req.apiKeyOwner!.siteId, req.apiKey!.id, id.data))) {
      return notFound(res, "Webhook not found");
    }
    await deleteWebhook(req.apiKeyOwner!.siteId, id.data);
    res.status(204).end();
  } catch (err) {
    sendServerError(res, "manage.webhooks", err);
  }
});

export default router;
