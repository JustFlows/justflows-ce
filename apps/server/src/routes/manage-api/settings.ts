// SPDX-License-Identifier: MIT

import { Router } from "express";
import { clientIp } from "../../lib/rate-limit.js";
import {
  applySettingsChange,
  getSettingsPayload,
  SettingsSchema,
} from "../../lib/settings-admin.js";
import { sendServerError } from "../../lib/send-error.js";
import { badRequest, ensureKeyCan, relay, sendJson } from "./envelope.js";

const router = Router();

router.get("/", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:read"))) return;
  try {
    // A key with settings:read sees the administrator view of settings.
    sendJson(req, res, await getSettingsPayload({ isAdmin: true }));
  } catch (err) {
    sendServerError(res, "manage.settings", err);
  }
});

router.patch("/", async (req, res) => {
  if (!(await ensureKeyCan(req, res, "settings:manage"))) return;
  const body = SettingsSchema.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues[0]?.message ?? "Invalid settings");
  try {
    relay(
      res,
      await applySettingsChange(body.data, {
        siteId: req.apiKeyOwner!.siteId,
        userId: req.apiKeyOwner!.userId,
        role: "api-key",
        ip: clientIp(req),
        userAgent: req.get("user-agent") ?? null,
      }),
    );
  } catch (err) {
    sendServerError(res, "manage.settings", err);
  }
});

export default router;
