// SPDX-License-Identifier: MIT

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { getControlDb } from "../../lib/database/db.js";
import { clientIp } from "../../lib/security/rate-limit.js";
import { isPlatformOperator } from "../../lib/tenancy/access.js";
import {
  createAdditionalSite,
  createWorkspace,
  deleteTenant,
  reactivateTenant,
  suspendTenant,
} from "../../lib/tenancy/provision.js";
import { forbidden, sendError, unauthorized } from "./envelope.js";

const router = Router();

const writeLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `manage-tenancy:${req.apiKey?.id ?? clientIp(req)}`,
});

const DatabaseSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  database: z.string().min(1).max(64),
  username: z.string().min(1).max(255),
  password: z.string().max(1024),
});

const AdminSchema = z.object({
  email: z.string().email(),
  username: z.string().min(2).max(60),
  displayName: z.string().min(1).max(255),
  password: z.string().min(12).max(1024),
});

async function requireOperator(req: { apiKeyOwner?: { userId: string } }, res: Parameters<typeof forbidden>[0]): Promise<boolean> {
  const userId = req.apiKeyOwner?.userId;
  if (!userId) {
    unauthorized(res);
    return false;
  }
  if (!(await isPlatformOperator(userId))) {
    forbidden(res);
    return false;
  }
  return true;
}

router.use(writeLimit);

router.get("/", async (req, res) => {
  if (!(await requireOperator(req, res))) return;
  const db = await getControlDb();
  const tenants = await db.query(
    `SELECT id, name, slug, status, user_mode, database_mode, created_at
     FROM tenants WHERE status <> 'deleted' ORDER BY created_at ASC`,
  );
  const sites = await db.query(
    `SELECT s.id, s.tenant_id, s.name, s.status, s.database_choice, d.hostname
     FROM sites s
     LEFT JOIN site_domains d ON d.site_id = s.id AND d.is_primary = ?
     WHERE s.status <> 'deleted'
     ORDER BY s.created_at ASC`,
    [true],
  );
  res.json({ tenants, sites });
});

router.post("/", async (req, res) => {
  if (!(await requireOperator(req, res))) return;
  const body = z.object({
    name: z.string().min(1).max(255),
    slug: z.string().max(60).optional(),
    userMode: z.enum(["isolated", "shared"]),
    databaseMode: z.enum(["current", "separate"]),
    siteName: z.string().min(1).max(255),
    hostname: z.string().min(1).max(253),
    admin: AdminSchema,
    database: DatabaseSchema.optional(),
  }).safeParse(req.body);
  if (!body.success) {
    sendError(res, 400, body.error.issues[0]?.message ?? "Invalid workspace");
    return;
  }
  const result = await createWorkspace({ ...body.data, actorId: req.apiKeyOwner!.userId, platformOperator: false });
  res.status(result.ok ? 201 : result.status).json(result.ok ? result : { error: result.error });
});

router.post("/:id/sites", async (req, res) => {
  if (!(await requireOperator(req, res))) return;
  const body = z.object({
    name: z.string().min(1).max(255),
    hostname: z.string().min(1).max(253),
    databaseChoice: z.enum(["inherit", "current", "separate"]),
    database: DatabaseSchema.optional(),
    admin: AdminSchema.optional(),
  }).safeParse(req.body);
  if (!body.success) {
    sendError(res, 400, body.error.issues[0]?.message ?? "Invalid site");
    return;
  }
  const result = await createAdditionalSite({
    tenantId: String(req.params.id),
    ...body.data,
    actorId: req.apiKeyOwner!.userId,
  });
  res.status(result.ok ? 201 : result.status).json(result.ok ? result : { error: result.error });
});

router.post("/:id/suspend", async (req, res) => {
  if (!(await requireOperator(req, res))) return;
  const result = await suspendTenant(String(req.params.id), req.apiKeyOwner!.userId);
  res.status(result.ok ? 200 : result.status).json(result.ok ? { ok: true } : { error: result.error });
});

router.post("/:id/reactivate", async (req, res) => {
  if (!(await requireOperator(req, res))) return;
  const result = await reactivateTenant(String(req.params.id), req.apiKeyOwner!.userId);
  res.status(result.ok ? 200 : result.status).json(result.ok ? { ok: true } : { error: result.error });
});

router.delete("/:id", async (req, res) => {
  if (!(await requireOperator(req, res))) return;
  const dropDatabase = req.body?.dropDatabase === true;
  const result = await deleteTenant(String(req.params.id), req.apiKeyOwner!.userId, dropDatabase);
  res.status(result.ok ? 200 : result.status).json(result.ok ? { ok: true } : { error: result.error });
});

export default router;
