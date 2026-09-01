// SPDX-License-Identifier: MIT

import { Router } from "express";
import { z } from "zod";
import { requireSession } from "../middleware/auth.js";
import { param } from "../lib/params.js";
import { sendServerError } from "../lib/send-error.js";
import { getUserPreferences, setUserPreference } from "../lib/user-preferences.js";

const router = Router();

/** Dashboard welcome / discovery panel: minimized and dismissed flags. */
const DashboardWelcomeSchema = z
  .object({
    dismissed: z.boolean(),
    collapsed: z.boolean(),
  })
  .strict();

/**
 * The only preference keys the admin UI may read or write for its own user.
 * Anything not listed here is rejected so the table cannot be filled with
 * arbitrary keys.
 */
const PREFERENCE_SCHEMAS = {
  dashboard_welcome: DashboardWelcomeSchema,
} as const;

type PreferenceKey = keyof typeof PREFERENCE_SCHEMAS;

function isPreferenceKey(key: string): key is PreferenceKey {
  return Object.prototype.hasOwnProperty.call(PREFERENCE_SCHEMAS, key);
}

router.get("/", requireSession, async (req, res) => {
  try {
    const stored = await getUserPreferences(req.session!.userId);
    const preferences: Record<string, unknown> = {};
    for (const key of Object.keys(PREFERENCE_SCHEMAS) as PreferenceKey[]) {
      if (key in stored) preferences[key] = stored[key];
    }
    res.json({ preferences });
  } catch (err) {
    sendServerError(res, "preferences", err);
  }
});

router.put("/:key", requireSession, async (req, res) => {
  const key = param(req.params.key);
  if (!isPreferenceKey(key)) {
    res.status(400).json({ error: "Unknown preference" });
    return;
  }

  const parsed = PREFERENCE_SCHEMAS[key].safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid preference" });
    return;
  }

  try {
    await setUserPreference(req.session!.userId, key, parsed.data);
    res.json({ key, value: parsed.data });
  } catch (err) {
    sendServerError(res, "preferences", err);
  }
});

export default router;
