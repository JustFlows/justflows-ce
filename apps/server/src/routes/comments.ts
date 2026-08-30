import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { requireRole } from "../middleware/auth.js";
import { sanitizeRichText, esc } from "@justflows/blocks";
import { notifyOnApproval } from "../lib/comments-public.js";
import { param } from "../lib/params.js";

const router = Router();

function now(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

const COMMENT_STATUSES = new Set(["pending", "approved", "spam", "trash"]);

// Comment rows carry commenter names and email addresses. Read access matches
// the write handlers below rather than "any signed-in user".
router.get("/", requireRole("administrator", "editor"), async (req, res) => {
  const session = req.session!;
  const requested = (req.query.status as string) ?? "pending";
  const status = COMMENT_STATUSES.has(requested) ? requested : "pending";
  const limit = Math.min(Math.max(Number(req.query.limit ?? "30"), 1), 100);
  const page = Math.min(Math.max(Number(req.query.page ?? "1"), 1), 100_000);
  const offset = (page - 1) * limit;

  const db = await getDb();
  const [rows, countRows] = await Promise.all([
    db.query<Record<string, unknown>>(
      `SELECT c.id, c.parent_id, c.content_id, c.author_name, c.author_email, c.author_url,
              c.body, c.status, c.created_at, c.edited_at,
              co.title AS content_title, co.slug AS content_slug
         FROM comments c
         LEFT JOIN content co ON c.content_id = co.id
        WHERE c.site_id = ? AND c.status = ?
        ORDER BY c.created_at DESC
        LIMIT ? OFFSET ?`,
      [session.siteId, status, limit, offset],
    ),
    db.query<{ total: number }>(
      "SELECT COUNT(*) AS total FROM comments WHERE site_id = ? AND status = ?",
      [session.siteId, status],
    ),
  ]);
  res.json({ comments: rows, total: Number(countRows[0]?.total ?? 0), page, limit });
});

const ApproveSchema = z.object({
  ids: z.array(z.string()).min(1),
  action: z.enum(["approve", "pending", "spam", "trash"]),
});

router.patch("/", requireRole("administrator", "editor"), async (req, res) => {
  const session = req.session!;
  const body = ApproveSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message });
    return;
  }

  const statusMap = {
    approve: "approved",
    pending: "pending",
    spam: "spam",
    trash: "trash",
  } as const;
  const newStatus = statusMap[body.data.action];
  const db = await getDb();

  for (const id of body.data.ids) {
    await db.run("UPDATE comments SET status = ?, updated_at = ? WHERE id = ? AND site_id = ?", [
      newStatus,
      now(),
      id,
      session.siteId,
    ]);
  }

  if (newStatus === "approved") {
    void notifyOnApproval(session.siteId, body.data.ids).catch(() => undefined);
  }

  res.json({ ok: true, updated: body.data.ids.length });
});

const EditSchema = z.object({
  body: z.string().min(1).max(20_000).optional(),
  status: z.enum(["pending", "approved", "spam", "trash"]).optional(),
});

router.patch("/:id", requireRole("administrator", "editor"), async (req, res) => {
  const session = req.session!;
  const parsed = EditSchema.safeParse(req.body);
  if (!parsed.success || (parsed.data.body === undefined && parsed.data.status === undefined)) {
    res.status(400).json({ error: parsed.success ? "Nothing to update" : parsed.error.issues[0]?.message });
    return;
  }
  const db = await getDb();
  const sets: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [now()];
  if (parsed.data.body !== undefined) {
    const clean = sanitizeRichText(
      parsed.data.body
        .split(/\n{2,}/)
        .map((para) => `<p>${esc(para).replace(/\n/g, "<br>")}</p>`)
        .join(""),
    );
    if (!clean.replace(/<[^>]*>/g, "").trim()) {
      res.status(400).json({ error: "Comment body is empty" });
      return;
    }
    sets.push("body = ?", "edited_at = ?");
    params.push(clean, now());
  }
  if (parsed.data.status !== undefined) {
    sets.push("status = ?");
    params.push(parsed.data.status);
  }
  params.push(param(req.params.id), session.siteId);
  await db.run(`UPDATE comments SET ${sets.join(", ")} WHERE id = ? AND site_id = ?`, params);

  if (parsed.data.status === "approved") {
    void notifyOnApproval(session.siteId, [param(req.params.id)]).catch(() => undefined);
  }
  res.json({ ok: true });
});

const ReplySchema = z.object({ body: z.string().min(1).max(20_000) });

router.post("/:id/reply", requireRole("administrator", "editor"), async (req, res) => {
  const session = req.session!;
  const parsed = ReplySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }
  const db = await getDb();
  const parentRows = await db.query<{ id: string; content_id: string }>(
    "SELECT id, content_id FROM comments WHERE id = ? AND site_id = ? LIMIT 1",
    [param(req.params.id), session.siteId],
  );
  const parent = parentRows[0];
  if (!parent) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }
  const userRows = await db.query<{ display_name: string; username: string; email: string }>(
    "SELECT display_name, username, email FROM users WHERE id = ? AND site_id = ? LIMIT 1",
    [session.userId, session.siteId],
  );
  const u = userRows[0];
  const authorName = (u?.display_name || u?.username || "Moderator").slice(0, 120);
  const clean = sanitizeRichText(
    parsed.data.body
      .split(/\n{2,}/)
      .map((para) => `<p>${esc(para).replace(/\n/g, "<br>")}</p>`)
      .join(""),
  );
  if (!clean.replace(/<[^>]*>/g, "").trim()) {
    res.status(400).json({ error: "Reply is empty" });
    return;
  }
  const id = randomUUID();
  const ts = now();
  await db.run(
    `INSERT INTO comments
       (id, site_id, content_id, parent_id, author_name, author_email, body, status, user_id, notify, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)`,
    [id, session.siteId, parent.content_id, parent.id, authorName, u?.email ?? null, clean, session.userId, false, ts, ts],
  );
  void notifyOnApproval(session.siteId, [id]).catch(() => undefined);
  res.json({ ok: true, id });
});

const DeleteSchema = z.object({ ids: z.array(z.string()).min(1) });

/** Hard-delete comments that are already in the trash. */
router.delete("/", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  const parsed = DeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }
  const db = await getDb();
  let deleted = 0;
  for (const id of parsed.data.ids) {
    await db.run("DELETE FROM comments WHERE id = ? AND site_id = ? AND status = 'trash'", [
      id,
      session.siteId,
    ]);
    deleted++;
  }
  res.json({ ok: true, deleted });
});

export default router;
