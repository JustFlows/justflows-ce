// SPDX-License-Identifier: MIT

import type { Response } from "express";
import { logSafe } from "./log-safe.js";

/**
 * Answer an unexpected failure without describing the machine.
 *
 * Route handlers serialised the exception into the response body —
 * `res.status(500).json({ error: String(err) })` — so a driver error named the
 * database host, port, schema and column, and a filesystem error gave up
 * absolute paths. The global handler in register-routes.ts already did the
 * right thing; the per-route catches ran first and never reached it.
 *
 * The detail is not lost, it moves to the log, which is where an operator can
 * read it and an anonymous caller cannot.
 */
export function sendServerError(res: Response, context: string, err: unknown): void {
  console.error(`[justflows] ${logSafe(context)}:`, err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
}
