import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { requireRole } from "../middleware/auth.js";
import { param } from "../lib/params.js";
import { hashPassword } from "../lib/password.js";
import { getGeneralSettings } from "../lib/general-settings.js";
import { USER_ROLE_VALUES } from "../lib/rbac.js";

const router = Router();

const CreateSchema = z.object({
  email: z.string().email(),
  username: z.string().min(2).max(60),
  displayName: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(USER_ROLE_VALUES).optional(),
});

function now(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

router.get("/", requireRole("administrator", "editor"), async (req, res) => {
  const session = req.session!;

  try {
    const db = await getDb();
    const rows = await db.query<Record<string, unknown>>(
      "SELECT id, email, username, display_name, role, created_at FROM users WHERE site_id = ? ORDER BY created_at ASC",
      [session.siteId],
    );
    res.json({ users: rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/", requireRole("administrator"), async (req, res) => {
  const session = req.session!;

  try {
    const body = CreateSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.issues[0]?.message });
      return;
    }

    const { email, username, displayName, password } = body.data;
    const general = await getGeneralSettings(session.siteId);
    const role = body.data.role ?? general.defaultRole;
    const passwordHash = await hashPassword(password);
    const id = randomUUID();
    const db = await getDb();

    await db.run(
      `INSERT INTO users (id, site_id, email, username, display_name, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, session.siteId, email.toLowerCase(), username, displayName, passwordHash, role, now(), now()],
    );

    res.status(201).json({ id, email, username, displayName, role });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

const PatchSchema = z.object({
  role: z.enum(USER_ROLE_VALUES).optional(),
  displayName: z.string().min(1).optional(),
});

router.patch("/:id", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  const userId = param(req.params.id);
  const body = PatchSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid request" });
    return;
  }
  const { role, displayName } = body.data;

  try {
    const db = await getDb();
    const fields: string[] = [];
    const values: (string | number | boolean | null)[] = [];

    if (role) {
      fields.push("role = ?");
      values.push(role);
    }
    if (displayName) {
      fields.push("display_name = ?");
      values.push(displayName);
    }

    if (fields.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    fields.push("updated_at = ?");
    values.push(now(), userId, session.siteId);

    await db.run(`UPDATE users SET ${fields.join(", ")} WHERE id = ? AND site_id = ?`, values);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete("/:id", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  const userId = param(req.params.id);
  if (userId === session.userId) {
    res.status(400).json({ error: "Cannot delete yourself" });
    return;
  }

  const db = await getDb();
  await db.run("DELETE FROM users WHERE id = ? AND site_id = ?", [userId, session.siteId]);
  res.json({ ok: true });
});

export default router;
