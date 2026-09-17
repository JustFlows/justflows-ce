// SPDX-License-Identifier: MIT

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * A signed, timestamped token embedded as a hidden field in the public
 * comment form. Its age at submission time is one spam signal among several
 * (see comments-spam-score.ts) — a bot that skips rendering the page entirely
 * has no token at all, and one that replays a page instantly submits a token
 * that is younger than any human's read-and-type time.
 */

const TokenSchema = z
  .object({
    contentId: z.string(),
    siteId: z.string(),
    issuedAt: z.number().int().positive(),
  })
  .strict();
export type CommentFormToken = z.infer<typeof TokenSchema>;

/** Tokens older than this are treated the same as a missing token. */
const MAX_TOKEN_AGE_MS = 6 * 60 * 60_000;

function signature(value: string): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) throw new Error("Comment form token signing is unavailable");
  return createHmac("sha256", secret).update("justflows:comment-form-token:v1:").update(value).digest();
}

export function createCommentFormToken(
  input: Omit<CommentFormToken, "issuedAt">,
  now = Date.now(),
): string {
  const payload = TokenSchema.parse({ ...input, issuedAt: now });
  const value = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${value}.${signature(value).toString("base64url")}`;
}

/** Returns null for a missing, malformed, forged, or stale token. */
export function verifyCommentFormToken(token: unknown, now = Date.now()): CommentFormToken | null {
  if (typeof token !== "string" || token.length > 512) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const expected = signature(parts[0]!);
    const supplied = Buffer.from(parts[1]!, "base64url");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const result = TokenSchema.safeParse(
      JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")),
    );
    if (!result.success) return null;
    return now - result.data.issuedAt <= MAX_TOKEN_AGE_MS ? result.data : null;
  } catch {
    return null;
  }
}
