import { Router } from "express";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();

function now(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

const COMMENT_STATUSES = new Set(["pending", "approved", "spam", "trash"]);

// Comment rows carry commenter names and email addresses. Read access matches
// the PATCH handler below rather than "any signed-in user".
router.get("/", requireRole("administrator", "editor"), async (req, res) => {
  const session = req.session!;
  const requested = (req.query.status as string) ?? "pending";
  const status = COMMENT_STATUSES.has(requested) ? requested : "pending";
  const limit = Math.min(Number(req.query.limit ?? "30"), 100);

  const db = await getDb();
  const rows = await db.query<Record<string, unknown>>(
    `SELECT c.*, co.title AS content_title FROM comments c
     LEFT JOIN content co ON c.content_id = co.id
     WHERE c.site_id = ? AND c.status = ?
     ORDER BY c.created_at DESC LIMIT ?`,
    [session.siteId, status, limit],
  );
  res.json({ comments: rows });
});

const ApproveSchema = z.object({
  ids: z.array(z.string()),
  action: z.enum(["approve", "spam", "trash"]),
});

router.patch("/", requireRole("administrator", "editor"), async (req, res) => {
  const session = req.session!;
  const body = ApproveSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message });
    return;
  }

  const statusMap = { approve: "approved", spam: "spam", trash: "trash" } as const;
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

  res.json({ ok: true, updated: body.data.ids.length });
});

export default router;
