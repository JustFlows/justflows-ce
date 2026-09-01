// SPDX-License-Identifier: MIT

import { Router } from "express";
import { requireRole } from "../middleware/auth.js";
import { sendServerError } from "../lib/send-error.js";
import {
  getResolvedCookieRegistry,
  getCookieOverrides,
  setCookieOverrides,
} from "../lib/cookie-registry.js";

const router = Router();

/** The site cookie registry: platform cookies plus every active plugin's
 * declarations, with the operator's category overrides applied. */
router.get("/", requireRole("administrator", "editor"), async (req, res) => {
  try {
    const siteId = req.session!.siteId;
    const [cookies, overrides] = await Promise.all([
      getResolvedCookieRegistry(siteId),
      getCookieOverrides(siteId),
    ]);
    res.json({ cookies, overrides });
  } catch (err) {
    sendServerError(res, "cookies", err);
  }
});

/** Re-classify cookies by name. Body: `{ overrides: { "<name>": "<category>" } }`. */
router.put("/overrides", requireRole("administrator"), async (req, res) => {
  try {
    const body = (req.body ?? {}) as { overrides?: Record<string, unknown> };
    const stored = await setCookieOverrides(req.session!.siteId, body.overrides ?? {});
    const cookies = await getResolvedCookieRegistry(req.session!.siteId);
    res.json({ cookies, overrides: stored });
  } catch (err) {
    sendServerError(res, "cookies", err);
  }
});

export default router;
