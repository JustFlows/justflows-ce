// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import type { AccessResource, UserCapability } from "@justflows/sdk";
import { keyCan } from "../../lib/api-keys.js";

/**
 * Shared response envelope for `/api/manage/v1`: the `{ error }` shape the
 * cookie API already uses, cursor pagination, ETag / `If-None-Match`, and the
 * per-request capability check every handler runs before touching a service.
 */

export function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

export function unauthorized(res: Response): void {
  sendError(res, 401, "Unauthorized");
}

export function forbidden(res: Response): void {
  sendError(res, 403, "Forbidden");
}

export function badRequest(res: Response, message = "Bad request"): void {
  sendError(res, 400, message);
}

export function notFound(res: Response, message = "Not found"): void {
  sendError(res, 404, message);
}

/** Relay a `{ status, body }` result from a shared service function. */
export function relay(res: Response, result: { status: number; body: unknown }): void {
  res.status(result.status).json(result.body);
}

/**
 * Confirm the request's API key may exercise `capability` on `resource` right
 * now. Writes the 401/403 and returns false when it may not.
 */
export async function ensureKeyCan(
  req: Request,
  res: Response,
  capability: UserCapability,
  resource: AccessResource = {},
): Promise<boolean> {
  const key = req.apiKey;
  const owner = req.apiKeyOwner;
  if (!key || !owner) {
    unauthorized(res);
    return false;
  }
  if (!(await keyCan(key, owner, capability, resource))) {
    forbidden(res);
    return false;
  }
  return true;
}

export interface Page<T> {
  data: T[];
  page: { limit: number; cursor: string | null; nextCursor: string | null; total: number };
}

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
}

export function decodeCursor(cursor: unknown): number {
  if (typeof cursor !== "string" || !cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString()) as { o?: unknown };
    const offset = Number(parsed.o);
    return Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;
  } catch {
    return 0;
  }
}

export function parseLimit(value: unknown, fallback = 50, max = 200): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/** Slice an in-memory list into a cursor-paginated envelope. */
export function paginate<T>(items: T[], req: Request, fallbackLimit = 50): Page<T> {
  const limit = parseLimit(req.query.limit, fallbackLimit);
  const offset = decodeCursor(req.query.cursor);
  const slice = items.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  return {
    data: slice,
    page: {
      limit,
      cursor: offset > 0 ? encodeCursor(offset) : null,
      nextCursor: nextOffset < items.length ? encodeCursor(nextOffset) : null,
      total: items.length,
    },
  };
}

// codeql[js/insufficient-password-hash]: not a credential hash. `payload` is
// an arbitrary JSON response body — for the settings routes that can include
// password-reset *settings* (`passwordResetEnabled`/`passwordResetRoles`,
// booleans and a role list), never a password value; CodeQL's taint tracker
// flags the field names, not real secret material. SHA-1 here only has to be
// fast and collision-resistant enough for an HTTP ETag / If-None-Match check.
export function etagFor(payload: unknown): string {
  return `"${createHash("sha1").update(JSON.stringify(payload)).digest("base64url")}"`;
}

/** Send JSON with an ETag, answering 304 when `If-None-Match` matches. */
export function sendJson(req: Request, res: Response, payload: unknown): void {
  const etag = etagFor(payload);
  res.setHeader("ETag", etag);
  const inm = req.get("if-none-match");
  if (inm && inm === etag) {
    res.status(304).end();
    return;
  }
  res.json(payload);
}
