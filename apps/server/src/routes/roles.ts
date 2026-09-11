// SPDX-License-Identifier: MIT
import { Router, type Request } from "express";
import { requireCapability } from "../middleware/auth.js";
import { param } from "../lib/params.js";
import { sendServerError } from "../lib/send-error.js";
import {
  createRole,
  deleteRole,
  listRoles,
  RoleSchema,
  updateRole,
  type RoleAdminActor,
} from "../lib/roles-admin.js";

const router = Router();
const manage = requireCapability("users:manage");

function actorOf(req: Request): RoleAdminActor {
  const session = req.session!;
  return {
    siteId: session.siteId,
    userId: session.userId,
    role: session.role,
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

router.get("/", requireCapability("users:read"), async (req, res) => {
  try {
    res.json(await listRoles(req.session!.siteId));
  } catch (err) {
    sendServerError(res, "roles", err);
  }
});

router.post("/", manage, async (req, res) => {
  const body = RoleSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message });
    return;
  }
  try {
    const result = await createRole(body.data, actorOf(req));
    res.status(result.status).json(result.body);
  } catch (err) {
    sendServerError(res, "roles", err);
  }
});

router.patch("/:id", manage, async (req, res) => {
  const body = RoleSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message });
    return;
  }
  try {
    const result = await updateRole(param(req.params.id), body.data, actorOf(req));
    res.status(result.status).json(result.body);
  } catch (err) {
    sendServerError(res, "roles", err);
  }
});

router.delete("/:id", manage, async (req, res) => {
  try {
    const result = await deleteRole(param(req.params.id), actorOf(req));
    res.status(result.status).json(result.body);
  } catch (err) {
    sendServerError(res, "roles", err);
  }
});

export default router;
