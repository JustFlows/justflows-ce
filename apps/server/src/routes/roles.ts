// SPDX-License-Identifier: MIT
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { ROLE_CAPABILITIES } from "@justflows/sdk";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { availableCapabilityDefinitions, CAPABILITY_ID_PATTERN } from "../lib/access-policy.js";
import { auditFromRequest } from "../lib/audit-log.js";
import { requireCapability } from "../middleware/auth.js";
import { param } from "../lib/params.js";
import { sendServerError } from "../lib/send-error.js";

const router = Router();
const CapabilitySchema = z.string().regex(CAPABILITY_ID_PATTERN);
const RoleSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  capabilities: z.array(CapabilitySchema).max(250),
});
const manage = requireCapability("users:manage");

async function emitRoleEvent(
  event: "access.roleCreated" | "access.roleUpdated" | "access.roleDeleted",
  roleId: string,
  siteId: string,
): Promise<void> {
  const { getRuntimeHooks } = await import("../lib/plugin-runtime.js");
  await getRuntimeHooks().dispatchAction(event, { roleId }, { siteId, source: "http" });
}

router.get("/", requireCapability("users:read"), async (req, res) => {
  try {
    const db = await getDb();
    const capabilityDefinitions = await availableCapabilityDefinitions();
    const custom = await db.query<Record<string, unknown>>(
      "SELECT id, name, description, capabilities_json, created_at, updated_at FROM access_roles WHERE site_id = ? ORDER BY name",
      [req.session!.siteId],
    );
    const builtIn = Object.entries(ROLE_CAPABILITIES).map(([id, capabilities]) => ({
      id, name: id, description: "Built-in role", builtIn: true,
      capabilities: [...capabilities, ...capabilityDefinitions.filter((definition) => definition.pluginId && (definition.defaultRoles ?? ["administrator"]).includes(id)).map(({ id }) => id)],
    }));
    res.json({
      roles: [...builtIn, ...custom.map((role) => ({
        ...role,
        builtIn: false,
        capabilities: JSON.parse(String(role.capabilities_json ?? "[]")),
      }))],
      capabilities: capabilityDefinitions,
    });
  } catch (err) { sendServerError(res, "roles", err); }
});

router.post("/", manage, async (req, res) => {
  const body = RoleSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.issues[0]?.message }); return; }
  try {
    const available = new Set((await availableCapabilityDefinitions()).map(({ id }) => id));
    if (body.data.capabilities.some((capability) => !available.has(capability))) { res.status(400).json({ error: "Unknown or inactive capability" }); return; }
    const id = randomUUID();
    const db = await getDb();
    await db.run(
      "INSERT INTO access_roles (id, site_id, name, description, capabilities_json) VALUES (?, ?, ?, ?, ?)",
      [id, req.session!.siteId, body.data.name, body.data.description ?? null, JSON.stringify(body.data.capabilities)],
    );
    auditFromRequest(req, "access.role_created", { target: id, detail: `name=${body.data.name}` });
    await emitRoleEvent("access.roleCreated", id, req.session!.siteId);
    res.status(201).json({ role: { id, ...body.data, builtIn: false } });
  } catch (err) { sendServerError(res, "roles", err); }
});

router.patch("/:id", manage, async (req, res) => {
  const body = RoleSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.issues[0]?.message }); return; }
  const id = param(req.params.id);
  try {
    const db = await getDb();
    const available = new Set((await availableCapabilityDefinitions()).map(({ id }) => id));
    const current = await db.query<{ capabilities_json: string }>(
      "SELECT capabilities_json FROM access_roles WHERE id = ? AND site_id = ? LIMIT 1",
      [id, req.session!.siteId],
    );
    const preserved = new Set<string>(JSON.parse(current[0]?.capabilities_json ?? "[]"));
    if (body.data.capabilities.some((capability) => !available.has(capability) && !preserved.has(capability))) { res.status(400).json({ error: "Unknown or inactive capability" }); return; }
    const changed = await db.execute(
      "UPDATE access_roles SET name = ?, description = ?, capabilities_json = ?, updated_at = ? WHERE id = ? AND site_id = ?",
      [body.data.name, body.data.description ?? null, JSON.stringify(body.data.capabilities), new Date().toISOString(), id, req.session!.siteId],
    );
    if (!changed) { res.status(404).json({ error: "Role not found" }); return; }
    auditFromRequest(req, "access.role_updated", { target: id });
    await emitRoleEvent("access.roleUpdated", id, req.session!.siteId);
    res.json({ ok: true });
  } catch (err) { sendServerError(res, "roles", err); }
});

router.delete("/:id", manage, async (req, res) => {
  const id = param(req.params.id);
  try {
    const db = await getDb();
    const assigned = await db.query<{ count: number | string }>(
      "SELECT COUNT(*) AS count FROM user_access_policies WHERE role_id = ? AND site_id = ?",
      [id, req.session!.siteId],
    );
    if (Number(assigned[0]?.count ?? 0) > 0) {
      res.status(409).json({ error: "Reassign users before deleting this role" }); return;
    }
    const changed = await db.execute("DELETE FROM access_roles WHERE id = ? AND site_id = ?", [id, req.session!.siteId]);
    if (!changed) { res.status(404).json({ error: "Role not found" }); return; }
    auditFromRequest(req, "access.role_deleted", { target: id });
    await emitRoleEvent("access.roleDeleted", id, req.session!.siteId);
    res.json({ ok: true });
  } catch (err) { sendServerError(res, "roles", err); }
});

export default router;
