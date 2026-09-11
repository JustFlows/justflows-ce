import { Router, type Request } from "express";
import { z } from "zod";
import { requireRole } from "../middleware/auth.js";
import { param } from "../lib/params.js";
import {
  editComment,
  listComments,
  purgeTrashedComments,
  replyToComment,
  setCommentStatuses,
  type ModerationActor,
} from "../lib/comments-moderation.js";

const router = Router();

function actorOf(req: Request): ModerationActor {
  const session = req.session!;
  return {
    siteId: session.siteId,
    userId: session.userId,
    role: session.role,
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

// Comment rows carry commenter names and email addresses. Read access matches
// the write handlers below rather than "any signed-in user".
router.get("/", requireRole("administrator", "editor"), async (req, res) => {
  res.json(
    await listComments(req.session!.siteId, {
      status: req.query.status as string | undefined,
      limit: Number(req.query.limit ?? "30"),
      page: Number(req.query.page ?? "1"),
    }),
  );
});

const ApproveSchema = z.object({
  ids: z.array(z.string()).min(1),
  action: z.enum(["approve", "pending", "spam", "trash"]),
});

router.patch("/", requireRole("administrator", "editor"), async (req, res) => {
  const body = ApproveSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message });
    return;
  }
  const result = await setCommentStatuses(actorOf(req), body.data.ids, body.data.action);
  res.status(result.status).json(result.body);
});

const EditSchema = z.object({
  body: z.string().min(1).max(20_000).optional(),
  status: z.enum(["pending", "approved", "spam", "trash"]).optional(),
});

router.patch("/:id", requireRole("administrator", "editor"), async (req, res) => {
  const parsed = EditSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }
  const result = await editComment(actorOf(req), param(req.params.id), parsed.data);
  res.status(result.status).json(result.body);
});

const ReplySchema = z.object({ body: z.string().min(1).max(20_000) });

router.post("/:id/reply", requireRole("administrator", "editor"), async (req, res) => {
  const parsed = ReplySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }
  const result = await replyToComment(actorOf(req), param(req.params.id), parsed.data.body);
  res.status(result.status).json(result.body);
});

const DeleteSchema = z.object({ ids: z.array(z.string()).min(1) });

/** Hard-delete comments that are already in the trash. */
router.delete("/", requireRole("administrator"), async (req, res) => {
  const parsed = DeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }
  const result = await purgeTrashedComments(actorOf(req), parsed.data.ids);
  res.status(result.status).json(result.body);
});

export default router;
