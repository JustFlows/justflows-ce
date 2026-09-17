import { Router, type Request } from "express";
import { z } from "zod";
import { requireRole } from "../middleware/auth.js";
import { param } from "../lib/params.js";
import { addSpamTerm, listSpamTerms, removeSpamTerm, type RuleActor } from "../lib/comments-rules.js";

const router = Router();

function actorOf(req: Request): RuleActor {
  const session = req.session!;
  return {
    siteId: session.siteId,
    userId: session.userId,
    role: session.role,
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

router.get("/", requireRole("administrator", "editor"), async (req, res) => {
  res.json({ terms: await listSpamTerms(req.session!.siteId) });
});

const SpamTermSchema = z.object({
  kind: z.enum(["domain", "phrase"]),
  value: z.string().trim().min(1).max(255),
});

router.post("/", requireRole("administrator"), async (req, res) => {
  const parsed = SpamTermSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }
  const term = await addSpamTerm(actorOf(req), parsed.data);
  res.status(201).json(term);
});

router.delete("/:id", requireRole("administrator"), async (req, res) => {
  const ok = await removeSpamTerm(actorOf(req), param(req.params.id));
  if (!ok) {
    res.status(404).json({ error: "Term not found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
