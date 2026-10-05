// SPDX-License-Identifier: MIT

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getControlDb } from "../../lib/database/db.js";
import { requireSession } from "../../middleware/auth.js";
import { isPlatformOperator } from "../../lib/tenancy/access.js";
import { signupBaseDomain } from "../../lib/tenancy/host.js";
import { buildSaasSettings, readSaasSettings, withPurgeAfterDays } from "../../lib/tenancy/saas-settings.js";
import { purgeDeletedTenant } from "../../lib/tenancy/purge-deleted.js";
import {
  createAdditionalSite,
  createWorkspace,
  deleteTenant,
  migrateTenantDatabase,
  reactivateTenant,
  suspendTenant,
} from "../../lib/tenancy/provision.js";
import { decryptSecret } from "../../lib/security/secret-box.js";

const router = Router();

const DatabaseSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  database: z.string().min(1).max(64),
  username: z.string().min(1).max(255),
  password: z.string().max(1024),
});

async function requireOperator(req: { session?: { userId: string } }, res: { status(code: number): { json(body: unknown): void } }, next: () => void): Promise<void> {
  if (!req.session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!(await isPlatformOperator(req.session.userId))) {
    res.status(403).json({ error: "Platform operator access is required" });
    return;
  }
  next();
}

router.use(requireSession, (req, res, next) => {
  void requireOperator(req, res, next).catch(next);
});

router.get("/overview", async (_req, res) => {
  const db = await getControlDb();
  const tenants = await db.query(
    `SELECT t.id, t.name, t.slug, t.status, t.user_mode, t.database_mode, t.created_at
     FROM tenants t
     ORDER BY t.created_at ASC`,
  );
  const sites = await db.query(
    `SELECT s.id, s.tenant_id, s.name, s.url, s.status, s.database_choice, d.hostname
     FROM sites s
     LEFT JOIN site_domains d ON d.site_id = s.id AND d.is_primary = ?
     ORDER BY s.created_at ASC`,
    [true],
  );
  const databases = await db.query(
    `SELECT id, tenant_id, site_id, mode, status, driver, host, port, database_name, username, last_error, updated_at,
            CASE WHEN password_ciphertext IS NULL OR password_ciphertext = '' THEN ? ELSE ? END AS password_set
     FROM tenant_databases
     ORDER BY created_at ASC`,
    [false, true],
  );
  const settings = await db.query<{ value: unknown }>("SELECT value FROM platform_settings WHERE setting_key = 'saas' LIMIT 1");
  res.json({ tenants, sites, databases, settings: readSaasSettings(settings[0]?.value) });
});

const CreateTenant = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().max(60).optional(),
  userMode: z.enum(["isolated", "shared"]),
  databaseMode: z.enum(["current", "separate"]),
  siteName: z.string().min(1).max(255),
  hostname: z.string().min(1).max(253),
  admin: z.object({
    email: z.string().email(),
    username: z.string().min(2).max(60),
    displayName: z.string().min(1).max(255),
    password: z.string().min(12).max(1024),
  }),
  database: DatabaseSchema.optional(),
});

router.post("/tenants", async (req, res) => {
  const body = CreateTenant.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid workspace" });
    return;
  }
  const result = await createWorkspace({ ...body.data, actorId: req.session!.userId, platformOperator: false });
  res.status(result.ok ? 201 : result.status).json(result.ok ? result : { error: result.error });
});

const CreateSite = z.object({
  name: z.string().min(1).max(255),
  hostname: z.string().min(1).max(253),
  databaseChoice: z.enum(["inherit", "current", "separate"]),
  database: DatabaseSchema.optional(),
  admin: CreateTenant.shape.admin.optional(),
});

router.post("/tenants/:id/sites", async (req, res) => {
  const body = CreateSite.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid site" });
    return;
  }
  const result = await createAdditionalSite({
    tenantId: String(req.params.id),
    ...body.data,
    actorId: req.session!.userId,
  });
  res.status(result.ok ? 201 : result.status).json(result.ok ? result : { error: result.error });
});

router.post("/tenants/:id/suspend", async (req, res) => {
  const result = await suspendTenant(String(req.params.id), req.session!.userId);
  res.status(result.ok ? 200 : result.status).json(result.ok ? { ok: true } : { error: result.error });
});

router.post("/tenants/:id/reactivate", async (req, res) => {
  const result = await reactivateTenant(String(req.params.id), req.session!.userId);
  res.status(result.ok ? 200 : result.status).json(result.ok ? { ok: true } : { error: result.error });
});

router.post("/tenants/:id/purge", async (req, res) => {
  try {
    const result = await purgeDeletedTenant(String(req.params.id), req.session!.userId);
    res.status(result.ok ? 200 : result.status).json(result.ok ? { ok: true } : { error: result.error });
  } catch (err) {
    console.error("[justflows] Permanent delete failed:", err);
    res.status(502).json({ error: "The website could not be removed." });
  }
});

router.delete("/tenants/:id", async (req, res) => {
  const dropDatabase = req.body?.dropDatabase === true;
  const result = await deleteTenant(String(req.params.id), req.session!.userId, dropDatabase);
  res.status(result.ok ? 200 : result.status).json(result.ok ? { ok: true } : { error: result.error });
});

router.post("/databases/:id/migrate", async (req, res) => {
  const result = await migrateTenantDatabase(String(req.params.id), req.session!.userId);
  res.status(result.ok ? 200 : result.status).json(result.ok ? { ok: true } : { error: result.error });
});

router.post("/databases/:id/reveal", async (req, res) => {
  const db = await getControlDb();
  const rows = await db.query<{ password_ciphertext: string | null; tenant_id: string; database_name: string | null }>(
    "SELECT password_ciphertext, tenant_id, database_name FROM tenant_databases WHERE id = ? LIMIT 1",
    [String(req.params.id)],
  );
  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "Database not found" });
    return;
  }
  await db.run(
    "INSERT INTO platform_audit (id, actor_id, action, target, detail, created_at) VALUES (?, ?, 'database.reveal', ?, ?, ?)",
    [randomUUID(), req.session!.userId, row.tenant_id, row.database_name, new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "")],
  );
  res.json({ password: decryptSecret(row.password_ciphertext ?? "") });
});

const SettingsSchema = z.object({
  signupEnabled: z.boolean(),
  signupDatabaseMode: z.enum(["current", "separate"]).optional(),
  baseDomain: z.string().max(253),
  database: DatabaseSchema.optional(),
});

router.put("/settings", async (req, res) => {
  const body = SettingsSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid settings" });
    return;
  }
  const baseDomain = signupBaseDomain(body.data.baseDomain);
  if (baseDomain === null || (body.data.signupEnabled && !baseDomain)) {
    res.status(400).json({ error: "Signup domain must be a hostname such as example.com or localhost." });
    return;
  }
  const db = await getControlDb();
  const driver = process.env.DB_DRIVER;
  const existing = await db.query<{ value: unknown }>("SELECT value FROM platform_settings WHERE setting_key = 'saas' LIMIT 1");
  const built = buildSaasSettings(existing[0]?.value, {
    signupEnabled: body.data.signupEnabled,
    signupDatabaseMode: body.data.signupDatabaseMode ?? "current",
    baseDomain,
    database: body.data.database,
  });
  if (!built.ok) {
    res.status(400).json({ error: built.error });
    return;
  }
  const settings = built.stored;
  await storeSaasSettings(db, driver, settings);
  res.json({ ok: true, settings: readSaasSettings(settings) });
});

router.put("/settings/purge", async (req, res) => {
  const body = z.object({ purgeAfterDays: z.number().int().min(0).max(3650) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Enter a number of days from 0 to 3650." });
    return;
  }
  const db = await getControlDb();
  const existing = await db.query<{ value: unknown }>("SELECT value FROM platform_settings WHERE setting_key = 'saas' LIMIT 1");
  const settings = withPurgeAfterDays(existing[0]?.value, body.data.purgeAfterDays);
  await storeSaasSettings(db, process.env.DB_DRIVER, settings);
  res.json({ ok: true, settings: readSaasSettings(settings) });
});

async function storeSaasSettings(db: Awaited<ReturnType<typeof getControlDb>>, driver: string | undefined, settings: object): Promise<void> {
  const stamp = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  if (driver === "postgres") {
    // Pass the object. A JSON string bound to ::jsonb is stored as a JSON
    // string, and the platform page reloads with an empty form.
    await db.run(
      `INSERT INTO platform_settings (setting_key, value, updated_at) VALUES ('saas', ?::jsonb, ?)
       ON CONFLICT (setting_key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [settings as unknown as string, stamp],
    );
  } else {
    const value = JSON.stringify(settings);
    await db.run(
      `INSERT INTO platform_settings (setting_key, value, updated_at) VALUES ('saas', ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)`,
      [value, stamp],
    );
  }
}

export default router;
