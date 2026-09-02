// SPDX-License-Identifier: MIT

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDb } from "./db.js";

/**
 * Storage for self-service password recovery (#93).
 *
 * A "forgot password" request mints a high-entropy token, mails the link to the
 * account, and stores only the token's SHA-256 hash here. The reasoning matches
 * the session and mail-credential handling elsewhere: this does not defend
 * against a compromised server, but a database backup, a read-only injection or
 * a support export must not yield a working reset link.
 *
 * A row is single-use (`used_at`), time-limited (`expires_at`) and bound to one
 * account. Every read here treats a pre-0017 schema as "no resets" rather than
 * throwing, so a site whose migration has not run keeps signing in.
 */

/** Minutes a reset link stays valid. Deliberately short — a link is used once. */
export function resetTtlMinutes(): number {
  const raw = Number(process.env.JF_PASSWORD_RESET_TTL_MINUTES);
  if (Number.isFinite(raw) && raw >= 5 && raw <= 24 * 60) return Math.floor(raw);
  return 60;
}

/** The token is never stored or logged; only this digest is. */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sqlTime(d: Date): string {
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

export interface CreatedReset {
  /** The raw token — returned once, for the emailed link. Never persisted. */
  token: string;
  expiresAt: Date;
}

/**
 * Mint a single-use reset token for a user, invalidating any still outstanding.
 * One live link per account: a second request supersedes the first.
 */
export async function createPasswordReset(
  userId: string,
  siteId: string,
  requestedIp: string | null,
): Promise<CreatedReset> {
  const db = await getDb();
  await db.run("DELETE FROM password_resets WHERE user_id = ? AND site_id = ?", [userId, siteId]);

  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + resetTtlMinutes() * 60_000);

  await db.run(
    `INSERT INTO password_resets (id, user_id, site_id, token_hash, requested_ip, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      userId,
      siteId,
      hashResetToken(token),
      requestedIp ? requestedIp.slice(0, 64) : null,
      sqlTime(now),
      sqlTime(expiresAt),
    ],
  );

  return { token, expiresAt };
}

export interface ResolvedReset {
  id: string;
  userId: string;
  siteId: string;
}

/**
 * Resolve a raw token to a live (unused, unexpired) reset, or null.
 *
 * The expiry comparison is done in SQL against a formatted timestamp — the same
 * approach as `pruneAuditLog` — so this never has to parse a driver-specific
 * date back out of the row.
 */
export async function findLiveReset(token: string): Promise<ResolvedReset | null> {
  if (typeof token !== "string" || token.length < 16 || token.length > 512) return null;
  try {
    const db = await getDb();
    const rows = await db.query<{ id: string; user_id: string; site_id: string }>(
      `SELECT id, user_id, site_id FROM password_resets
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
       LIMIT 1`,
      [hashResetToken(token), sqlTime(new Date())],
    );
    const row = rows[0];
    if (!row) return null;
    return { id: String(row.id), userId: String(row.user_id), siteId: String(row.site_id) };
  } catch {
    // 0017_password_resets has not been applied. Recovery is unavailable until
    // it is; failing closed here is correct — there is nothing to resolve.
    return null;
  }
}

/** Stamp a row spent. Belt-and-braces before {@link clearUserResets}. */
export async function markResetUsed(id: string): Promise<void> {
  try {
    const db = await getDb();
    await db.run("UPDATE password_resets SET used_at = ? WHERE id = ?", [sqlTime(new Date()), id]);
  } catch {
    // pre-0017 schema — nothing to stamp.
  }
}

/**
 * Drop every reset row for a user.
 *
 * Called on a completed reset and on any password change (self-service change,
 * administrator reset), so a link minted before the password moved cannot be
 * redeemed afterwards.
 */
export async function clearUserResets(userId: string, siteId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.run("DELETE FROM password_resets WHERE user_id = ? AND site_id = ?", [userId, siteId]);
  } catch {
    // pre-0017 schema — nothing to clear.
  }
}

/** Opportunistic cleanup of spent and expired rows. */
export async function pruneExpiredResets(): Promise<void> {
  try {
    const db = await getDb();
    await db.run("DELETE FROM password_resets WHERE expires_at < ? OR used_at IS NOT NULL", [
      sqlTime(new Date()),
    ]);
  } catch {
    // pre-0017 schema — nothing to prune.
  }
}
