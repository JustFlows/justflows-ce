// SPDX-License-Identifier: MIT

import { Router } from "express";
import { listEventCatalog } from "../../lib/event-schemas.js";
import { sendServerError } from "../../lib/send-error.js";
import { sendJson } from "./envelope.js";

const router = Router();

/**
 * The platform event catalog — the same names a webhook endpoint subscribes
 * to, with payload schemas. Any authenticated key may read it. In-process
 * hooks (actions / gates / filters) are deliberately not exposed here: HTTP
 * integrations observe via webhook events and act via the management API.
 */
router.get("/", async (req, res) => {
  try {
    sendJson(req, res, { events: await listEventCatalog() });
  } catch (err) {
    sendServerError(res, "manage.events", err);
  }
});

export default router;
