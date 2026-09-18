import { Router, type Request } from "express";
import { z } from "zod";
import { requireRole } from "../../middleware/auth.js";
import { param } from "../../lib/http/params.js";
import {
  addRule,
  listRules,
  removeRule,
  RULE_FIELD_VALUES,
  RULE_LIST_VALUES,
  type RuleActor,
} from "../../lib/comments/comments-rules.js";

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
  res.json({ rules: await listRules(req.session!.siteId) });
});

const RuleSchema = z.object({
  list: z.enum(RULE_LIST_VALUES),
  field: z.enum(RULE_FIELD_VALUES),
  pattern: z.string().trim().min(1).max(500),
  note: z.string().max(500).optional(),
});

router.post("/", requireRole("administrator"), async (req, res) => {
  const parsed = RuleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }
  const rule = await addRule(actorOf(req), parsed.data);
  res.status(201).json(rule);
});

router.delete("/:id", requireRole("administrator"), async (req, res) => {
  const ok = await removeRule(actorOf(req), param(req.params.id));
  if (!ok) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
