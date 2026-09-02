import { Router } from "express";
import { requireCapability } from "../middleware/auth.js";
import { getAnalyticsSummary } from "../lib/analytics-public.js";
import { sendServerError } from "../lib/send-error.js";

const router = Router();

router.get("/", requireCapability("analytics:read"), async (req, res) => {
  try {
    const summary = await getAnalyticsSummary(req.session!.siteId);
    res.json(summary);
  } catch (err) {
    sendServerError(res, "analytics", err);
  }
});

export default router;
