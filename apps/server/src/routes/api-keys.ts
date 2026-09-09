// SPDX-License-Identifier: MIT

import { Router, type Request } from "express";
import { z } from "zod";
import { requireCapability } from "../middleware/auth.js";
import { auditFromRequest } from "../lib/audit-log.js";
import { sendServerError } from "../lib/send-error.js";
import { getEffectiveAccess } from "../lib/access-policy.js";
import {
  ApiKeyError,
  createApiKey,
  deleteApiKey,
  getApiKey,
  listApiKeys,
  rotateApiKey,
  revokeApiKey,
  updateApiKey,
  type ApiKeyRecord,
} from "../lib/api-keys.js";
import { getManageApiSettings, saveManageApiSettings } from "../lib/manage-api-settings.js";

const router = Router();
router.use(requireCapability("settings:manage"));

/** The record minus nothing sensitive — no secret or hash is ever stored here. */
function toDto(record: ApiKeyRecord) {
  return {
    id: record.id,
    name: record.name,
    keyPrefix: record.keyPrefix,
    ownerUserId: record.ownerUserId,
    capabilities: record.capabilities,
    scope: record.scope,
    allowedIps: record.allowedIps,
    allowedOrigins: record.allowedOrigins,
    rateLimitPerMin: record.rateLimitPerMin,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    lastUsedAt: record.lastUsedAt,
    lastUsedIp: record.lastUsedIp,
    requestCount: record.requestCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function ownerOf(req: Request) {
  const session = req.session!;
  return { userId: session.userId, siteId: session.siteId, role: session.role };
}

const CapabilityId = z.string().regex(/^[a-z][a-z0-9.:-]{1,79}$/);
const ScopeSchema = z
  .object({
    siteIds: z.array(z.string()).max(20).optional(),
    contentTypes: z.array(z.string()).max(50).optional(),
    locales: z.array(z.string()).max(50).optional(),
    ownership: z.enum(["any", "self"]).optional(),
  })
  .optional();

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  capabilities: z.array(CapabilityId).min(1).max(200),
  scope: ScopeSchema,
  allowedIps: z.array(z.string().max(64)).max(50).optional(),
  allowedOrigins: z.array(z.string().max(255)).max(50).optional(),
  rateLimitPerMin: z.number().int().min(1).max(100_000).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  capabilities: z.array(CapabilityId).min(1).max(200).optional(),
  scope: ScopeSchema,
  allowedIps: z.array(z.string().max(64)).max(50).optional(),
  allowedOrigins: z.array(z.string().max(255)).max(50).optional(),
  rateLimitPerMin: z.number().int().min(1).max(100_000).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

router.get("/", async (req, res) => {
  try {
    const keys = await listApiKeys(req.session!.siteId);
    res.json({ keys: keys.map(toDto) });
  } catch (err) {
    sendServerError(res, "api-keys", err);
  }
});

/** The capability set the caller may grant to a key — their own effective set. */
router.get("/capabilities", async (req, res) => {
  try {
    const access = await getEffectiveAccess(
      req.session!.userId,
      req.session!.siteId,
      req.session!.role,
    );
    res.json({ capabilities: [...access.capabilities].sort() });
  } catch (err) {
    sendServerError(res, "api-keys", err);
  }
});

router.get("/settings", async (_req, res) => {
  try {
    res.json(await getManageApiSettings());
  } catch (err) {
    sendServerError(res, "api-keys", err);
  }
});

const SettingsSchema = z.object({
  publicApiEnabled: z.boolean().optional(),
  enabled: z.boolean().optional(),
  rateLimitPerMin: z.number().int().min(1).max(100_000).optional(),
  allowedOrigins: z.array(z.string().max(255)).max(50).optional(),
});

router.put("/settings", async (req, res) => {
  const body = SettingsSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid settings" });
    return;
  }
  try {
    const saved = await saveManageApiSettings(body.data);
    if (body.data.publicApiEnabled !== undefined) {
      auditFromRequest(req, "public_api.toggled", {
        detail: body.data.publicApiEnabled ? "enabled" : "disabled",
      });
    }
    if (body.data.enabled !== undefined) {
      auditFromRequest(req, "manage_api.toggled", {
        detail: body.data.enabled ? "enabled" : "disabled",
      });
    }
    res.json(saved);
  } catch (err) {
    sendServerError(res, "api-keys", err);
  }
});

router.post("/", async (req, res) => {
  const body = CreateSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid key" });
    return;
  }
  try {
    const { record, secret } = await createApiKey({
      siteId: req.session!.siteId,
      name: body.data.name,
      owner: ownerOf(req),
      capabilities: body.data.capabilities,
      scope: body.data.scope,
      allowedIps: body.data.allowedIps,
      allowedOrigins: body.data.allowedOrigins,
      rateLimitPerMin: body.data.rateLimitPerMin ?? null,
      expiresAt: body.data.expiresAt ?? null,
    });
    auditFromRequest(req, "apikey.created", {
      target: record.id,
      detail: `caps=${record.capabilities.length}`,
    });
    res.status(201).json({ key: secret, record: toDto(record) });
  } catch (err) {
    if (err instanceof ApiKeyError) {
      res.status(400).json({ error: err.message });
      return;
    }
    sendServerError(res, "api-keys", err);
  }
});

router.patch("/:id", async (req, res) => {
  const body = PatchSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid patch" });
    return;
  }
  try {
    const updated = await updateApiKey(
      req.session!.siteId,
      req.params.id,
      {
        name: body.data.name,
        capabilities: body.data.capabilities,
        scope: body.data.scope,
        allowedIps: body.data.allowedIps,
        allowedOrigins: body.data.allowedOrigins,
        rateLimitPerMin: body.data.rateLimitPerMin,
        expiresAt: body.data.expiresAt,
      },
      ownerOf(req),
    );
    if (!updated) {
      res.status(404).json({ error: "Key not found" });
      return;
    }
    auditFromRequest(req, "apikey.updated", { target: updated.id });
    res.json({ record: toDto(updated) });
  } catch (err) {
    if (err instanceof ApiKeyError) {
      res.status(400).json({ error: err.message });
      return;
    }
    sendServerError(res, "api-keys", err);
  }
});

router.post("/:id/rotate", async (req, res) => {
  try {
    const rotated = await rotateApiKey(req.session!.siteId, req.params.id);
    if (!rotated) {
      res.status(404).json({ error: "Key not found" });
      return;
    }
    auditFromRequest(req, "apikey.rotated", { target: rotated.record.id });
    res.json({ key: rotated.secret, record: toDto(rotated.record) });
  } catch (err) {
    sendServerError(res, "api-keys", err);
  }
});

router.post("/:id/revoke", async (req, res) => {
  try {
    const existing = await getApiKey(req.session!.siteId, req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Key not found" });
      return;
    }
    await revokeApiKey(req.session!.siteId, req.params.id);
    auditFromRequest(req, "apikey.revoked", { target: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, "api-keys", err);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const removed = await deleteApiKey(req.session!.siteId, req.params.id);
    if (!removed) {
      res.status(404).json({ error: "Key not found" });
      return;
    }
    auditFromRequest(req, "apikey.deleted", { target: req.params.id });
    res.status(204).end();
  } catch (err) {
    sendServerError(res, "api-keys", err);
  }
});

export default router;
