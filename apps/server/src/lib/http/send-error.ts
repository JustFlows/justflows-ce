// SPDX-License-Identifier: MIT

import { QuotaRefusalError } from "../tenancy/quotas.js";
import type { Response } from "express";
import { ZodError } from "zod";
import { InvalidInputError } from "./invalid-input-error.js";
import { logSafe } from "../security/log-safe.js";
import { recordDiagnosticError } from "../runtime/diagnostics.js";

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
  if (err instanceof QuotaRefusalError) {
    if (!res.headersSent) res.status(err.status).json({ error: err.message, code: err.code, meter: err.meter });
    return;
  }
  const diagnostic = recordDiagnosticError(context, err);
  console.error(
    "[justflows] request failed:",
    JSON.stringify(logSafe(context)),
    JSON.stringify(logSafe(err instanceof Error ? err.message : String(err))),
  );
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error", requestId: diagnostic.requestId });
}

/** The most issues one message lists before it says how many more there are. */
const MAX_LISTED_ISSUES = 3;

/**
 * One readable sentence for a schema refusal: each issue with the field it is
 * about (`patterns.0.title: …`), instead of Zod's raw JSON issue list.
 */
export function describeZodError(err: ZodError): string {
  const parts = err.issues.slice(0, MAX_LISTED_ISSUES).map((issue) => {
    const path = issue.path.map(String).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  const more = err.issues.length - parts.length;
  if (more > 0) parts.push(`and ${more} more ${more === 1 ? "problem" : "problems"}`);
  return parts.join("; ") || "Invalid input";
}

/**
 * Answer a failed save: input the caller can fix gets 400 with what to fix,
 * everything else is logged and answered by {@link sendServerError}, so a
 * database driver's wording never reaches the browser (justflows-ce#315).
 *
 * Fixable input is a Zod refusal or an {@link InvalidInputError}. Routes check
 * their own conflict and not-found errors before calling this.
 */
export function sendInputOrServerError(res: Response, context: string, err: unknown): void {
  if (err instanceof ZodError) {
    if (!res.headersSent) res.status(400).json({ error: describeZodError(err) });
    return;
  }
  if (err instanceof InvalidInputError) {
    if (!res.headersSent) res.status(400).json({ error: err.message });
    return;
  }
  sendServerError(res, context, err);
}
