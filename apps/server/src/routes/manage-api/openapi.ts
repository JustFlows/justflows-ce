// SPDX-License-Identifier: MIT

import { Router } from "express";
import { MANAGE_API_OPENAPI } from "../../lib/openapi-manage.js";
import { getRuntimeHooks } from "../../lib/plugin-runtime.js";

const router = Router();

/**
 * The OpenAPI document for the whole authenticated surface. Run through the
 * `openapi.document` filter — the same one `/api/v1/openapi.json` uses — so a
 * plugin that registers management routes can advertise them too.
 */
router.get("/", async (_req, res) => {
  const document = structuredClone(MANAGE_API_OPENAPI) as unknown as Record<string, unknown>;
  const hooks = getRuntimeHooks();
  if (!hooks.has("openapi.document")) {
    res.json(document);
    return;
  }
  res.json(await hooks.applyFilter("openapi.document", document, { version: "manage/v1" }));
});

export default router;
