import { Router } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { requireRole } from "../middleware/auth.js";
import { param } from "../lib/params.js";
import { hashPassword } from "../lib/password.js";
import { getGeneralSettings } from "../lib/general-settings.js";
import { USER_ROLE_VALUES } from "../lib/rbac.js";
import { PasswordSchema } from "../lib/password-policy.js";
import { revokeUserSessions } from "../lib/auth-session.js";
import { auditFromRequest } from "../lib/audit-log.js";
import { erasePersonalData, exportPersonalData } from "../lib/personal-data.js";
import { sendServerError } from "../lib/send-error.js";
import { sendMail } from "../lib/mail.js";

const router = Router();

const CreateSchema = z.object({
  email: z.string().email(),
  username: z.string().min(2).max(60),
  displayName: z.string().min(1),
  password: PasswordSchema,
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
    sendServerError(res, "users", err);
  }
});

/** Number of administrators left on the site — the floor CRUD guards check against. */
async function countAdministrators(
  db: Awaited<ReturnType<typeof getDb>>,
  siteId: string,
): Promise<number> {
  const rows = await db.query<{ count: number | string }>(
    "SELECT COUNT(*) as count FROM users WHERE site_id = ? AND role = 'administrator'",
    [siteId],
  );
  return Number(rows[0]?.count ?? 0);
}

router.get("/:id", requireRole("administrator", "editor"), async (req, res) => {
  const session = req.session!;
  const userId = param(req.params.id);

  try {
    const db = await getDb();
    const rows = await db.query<Record<string, unknown>>(
      "SELECT id, email, username, display_name, role, created_at FROM users WHERE id = ? AND site_id = ? LIMIT 1",
      [userId, session.siteId],
    );
    if (!rows[0]) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ user: rows[0] });
  } catch (err) {
    sendServerError(res, "users", err);
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

    auditFromRequest(req, "user.created", { target: id, detail: `role=${role}` });
    res.status(201).json({ id, email, username, displayName, role });
  } catch (err) {
    sendServerError(res, "users", err);
  }
});

const InviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(USER_ROLE_VALUES).optional(),
});

router.post("/invite", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  const body = InviteSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid request" });
    return;
  }

  try {
    const email = body.data.email.toLowerCase();
    const localPart = email.slice(0, email.indexOf("@"));
    const usernameBase = localPart.replace(/[^a-z0-9_.-]/gi, "").slice(0, 51) || "user";
    const username = `${usernameBase}-${randomBytes(4).toString("hex")}`;
    const displayName = localPart.slice(0, 255);
    const password = randomBytes(24).toString("base64url");
    const role = body.data.role ?? "subscriber";
    const id = randomUUID();
    const timestamp = now();
    const db = await getDb();

    await db.run(
      `INSERT INTO users (id, site_id, email, username, display_name, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, session.siteId, email, username, displayName, await hashPassword(password), role, timestamp, timestamp],
    );

    auditFromRequest(req, "user.created", { target: id, detail: `role=${role}; invited=true` });
    const origin = (process.env.APP_URL ?? "").replace(/\/$/, "");
    const mail = await sendMail({
      to: email,
      subject: "You have been invited to Justflows",
      text: [
        "An administrator invited you to Justflows.",
        "",
        `Username: ${username}`,
        `Temporary password: ${password}`,
        origin ? `Sign in: ${origin}/login` : "Open the site's login page to sign in.",
        "",
        "Change your password after signing in.",
      ].join("\n"),
    });

    res.status(201).json({
      user: { id, email, username, displayName, role, createdAt: timestamp },
      mailSent: mail.ok,
      ...(!mail.ok ? { warning: `User created, but the invitation email could not be sent: ${mail.error}` } : {}),
    });
  } catch (err) {
    sendServerError(res, "users", err);
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

    if (role) {
      const target = (
        await db.query<{ role: string }>(
          "SELECT role FROM users WHERE id = ? AND site_id = ? LIMIT 1",
          [userId, session.siteId],
        )
      )[0];
      if (!target) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      if (target.role === "administrator" && role !== "administrator" && (await countAdministrators(db, session.siteId)) <= 1) {
        res.status(400).json({ error: "Cannot demote the last administrator" });
        return;
      }
    }

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
    // A role change is a privilege change, which is the single most useful
    // thing to be able to reconstruct after the fact.
    if (role) auditFromRequest(req, "user.role_changed", { target: userId, detail: `role=${role}` });
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, "users", err);
  }
});

const ResetPasswordSchema = z.object({ newPassword: PasswordSchema });

/**
 * Set another user's password.
 *
 * The counterpart to POST /api/auth/password: an administrator needs a way to
 * lock an account out of an attacker's hands without database access. No
 * current-password check — the administrator does not have it — so this is
 * deliberately administrator-only, and it revokes every session the account
 * has, including any the attacker is holding.
 */
router.post("/:id/password", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  const userId = param(req.params.id);
  const body = ResetPasswordSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid request" });
    return;
  }

  try {
    const db = await getDb();
    const rows = await db.query<{ email: string }>(
      "SELECT email FROM users WHERE id = ? AND site_id = ? LIMIT 1",
      [userId, session.siteId],
    );
    if (!rows[0]) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    await db.run("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ? AND site_id = ?", [
      await hashPassword(body.data.newPassword),
      now(),
      userId,
      session.siteId,
    ]);
    await revokeUserSessions(userId, session.siteId);
    auditFromRequest(req, "auth.password_reset", { target: userId });

    void import("../lib/mail.js")
      .then((mail) =>
        mail.sendMail({
          to: rows[0]!.email,
          subject: "Your password was reset",
          text:
            "An administrator reset the password on your Justflows account.\n\n" +
            "All sessions for the account have been signed out. If you did not " +
            "expect this, contact the site administrator.",
        }),
      )
      .catch((err) => console.error("Password-reset notice failed:", err));

    res.json({ ok: true });
  } catch (err) {
    console.error("Password reset error", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * Everything held about one account (GDPR Art. 15).
 *
 * Administrator only, and the export is generated on request rather than
 * stored — a file of somebody's personal data sitting on disk is the problem
 * this is meant to help with, not the solution.
 */
router.get("/:id/personal-data", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  try {
    const data = await exportPersonalData(session.siteId, param(req.params.id));
    if (!data) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.setHeader("Content-Disposition", `attachment; filename="personal-data-${param(req.params.id)}.json"`);
    res.json(data);
  } catch (err) {
    sendServerError(res, "users", err);
  }
});

const EraseSchema = z.object({
  /** Who inherits this user's content. Null leaves it unattributed. */
  reassignContentTo: z.string().uuid().nullable().optional(),
});

/**
 * Erase the personal data attached to an account (GDPR Art. 17).
 *
 * Separate from DELETE: removing the row and removing the person's data are
 * different operations, and conflating them is why deleting a user previously
 * left their comments, form submissions and IP addresses behind.
 */
router.post("/:id/erase", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  const userId = param(req.params.id);
  const body = EraseSchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid request" });
    return;
  }

  try {
    const result = await erasePersonalData(
      session.siteId,
      userId,
      body.data.reassignContentTo ?? null,
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    sendServerError(res, "users", err);
  }
});

router.delete("/:id", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  const userId = param(req.params.id);
  if (userId === session.userId) {
    res.status(400).json({ error: "Cannot delete yourself" });
    return;
  }

  try {
    const db = await getDb();
    const target = (
      await db.query<{ role: string }>(
        "SELECT role FROM users WHERE id = ? AND site_id = ? LIMIT 1",
        [userId, session.siteId],
      )
    )[0];
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (target.role === "administrator" && (await countAdministrators(db, session.siteId)) <= 1) {
      res.status(400).json({ error: "Cannot delete the last administrator" });
      return;
    }

    await db.run("DELETE FROM users WHERE id = ? AND site_id = ?", [userId, session.siteId]);
    auditFromRequest(req, "user.deleted", { target: userId });
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, "users", err);
  }
});

export default router;
