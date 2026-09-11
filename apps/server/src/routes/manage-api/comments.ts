// SPDX-License-Identifier: MIT

import { Router } from "express";
import { z } from "zod";
import { clientIp } from "../../lib/rate-limit.js";
import {
  editComment,
  listComments,
  purgeTrashedComments,
  replyToComment,
  setCommentStatuses,
  type ModerationActor,
} from "../../lib/comments-moderation.js";
import { sendServerError } from "../../lib/send-error.js";
import { badRequest, ensureKeyCan, paginate, relay, sendJson } from "./envelope.js";
import type { Request } from "express";

const router = Router();

function actorOf(req: Request): ModerationActor {
  return {
    siteId: req.apiKeyOwner!.siteId,
    userId: req.apiKeyOwner!.userId,
    role: "api-key",
    ip: clientIp(req),
    userAgent: req.get("user-agent") ?? null,
  };
}

router.get("/", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "comments:moderate"))) return;
  try {
    const listed = await listComments(req.apiKeyOwner!.siteId, {
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      limit: 100,
      page: Number(req.query.page ?? "1"),
    });
    sendJson(req, res, paginate(listed.comments, req));
  } catch (err) {
    sendServerError(res, "manage.comments", err);
  }
});

const BulkSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
  action: z.enum(["approve", "pending", "spam", "trash"]),
});

router.patch("/", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "comments:moderate"))) return;
  const body = BulkSchema.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid request");
  try {
    relay(res, await setCommentStatuses(actorOf(req), body.data.ids, body.data.action));
  } catch (err) {
    sendServerError(res, "manage.comments", err);
  }
});

const EditSchema = z.object({
  body: z.string().min(1).max(20_000).optional(),
  status: z.enum(["pending", "approved", "spam", "trash"]).optional(),
});

router.patch("/:id", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "comments:moderate"))) return;
  const body = EditSchema.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid request");
  try {
    relay(res, await editComment(actorOf(req), req.params.id, body.data));
  } catch (err) {
    sendServerError(res, "manage.comments", err);
  }
});

const ReplySchema = z.object({ body: z.string().min(1).max(20_000) });

router.post("/:id/reply", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "comments:moderate"))) return;
  const body = ReplySchema.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid request");
  try {
    relay(res, await replyToComment(actorOf(req), req.params.id, body.data.body));
  } catch (err) {
    sendServerError(res, "manage.comments", err);
  }
});

const DeleteSchema = z.object({ ids: z.array(z.string()).min(1).max(200) });

router.delete("/", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "comments:moderate"))) return;
  const body = DeleteSchema.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid request");
  try {
    relay(res, await purgeTrashedComments(actorOf(req), body.data.ids));
  } catch (err) {
    sendServerError(res, "manage.comments", err);
  }
});

export default router;
