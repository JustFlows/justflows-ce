// SPDX-License-Identifier: MIT

import { getDb } from "./db.js";
import { getGeneralSettings } from "./general-settings.js";
import { getSiteId } from "./site-settings.js";
import { hashPassword } from "./password.js";
import { revokeUserSessions } from "./auth-session.js";
import { auditLog } from "./audit-log.js";
import { sendTemplateMail } from "./mail.js";
import {
  clearUserResets,
  createPasswordReset,
  findLiveReset,
  markResetUsed,
  resetTtlMinutes,
  type ResolvedReset,
} from "./password-reset-db.js";

/**
 * Self-service password recovery (#93).
 *
 * The request side answers identically whether or not the address exists, and
 * the caller does not await it — so a "forgot password" POST takes the same time
 * for a real account, an unknown address, and an account whose role is not
 * allowed to self-serve. The completion side sets a new password and revokes
 * every session, but never establishes one: a second factor, lockout, and every
 * other login control still apply on the next sign-in.
 */

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

function appOrigin(): string {
  return (process.env.APP_URL ?? "").replace(/\/$/, "");
}

/** The link mailed to the account. The page strips the token from the URL on load. */
export function resetLinkFor(token: string): string {
  const query = `token=${encodeURIComponent(token)}`;
  const origin = appOrigin();
  return origin ? `${origin}/reset-password?${query}` : `/reset-password?${query}`;
}

function nowSql(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

interface ForgotUserRow {
  id: string;
  email: string;
  display_name: string;
  role: string;
}

/**
 * Act on a "forgot password" request.
 *
 * Resolves without disclosing whether `email` is a known address. When it is,
 * self-service reset is enabled, and the account's role is permitted, a
 * single-use link is mailed. Every outcome writes one audit row.
 */
export async function processForgotPassword(email: string, ctx: RequestContext): Promise<void> {
  const normalized = email.toLowerCase().trim();

  try {
    const siteId = await getSiteId();
    if (!siteId) return;

    const settings = await getGeneralSettings(siteId);

    const db = await getDb();
    const rows = await db.query<ForgotUserRow>(
      "SELECT id, email, display_name, role FROM users WHERE site_id = ? AND email = ? LIMIT 1",
      [siteId, normalized],
    );
    const user = rows[0];

    if (!settings.passwordResetEnabled) {
      // Feature is off site-wide. Nothing is mailed; record the attempt only
      // when it maps to a real account, so the log is not a list of guesses.
      if (user) {
        void auditLog({
          siteId,
          action: "auth.password_reset_failed",
          outcome: "failure",
          actorId: user.id,
          actorEmail: user.email,
          target: user.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          detail: "self-service reset is disabled",
        });
      }
      return;
    }

    if (!user) return;

    const allowedRoles = settings.passwordResetRoles;
    if (allowedRoles.length > 0 && !allowedRoles.includes(user.role as (typeof allowedRoles)[number])) {
      void auditLog({
        siteId,
        action: "auth.password_reset_failed",
        outcome: "failure",
        actorId: user.id,
        actorEmail: user.email,
        target: user.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: `self-service reset not permitted for role ${user.role}`,
      });
      return;
    }

    const { token, expiresAt } = await createPasswordReset(user.id, siteId, ctx.ip);
    const minutes = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));
    const link = resetLinkFor(token);

    // Local-development convenience: print the link so a reset can be tested
    // without a mail catcher. Deliberately gated on NODE_ENV === "development"
    // (not merely "not production") so an unset NODE_ENV never leaks a token to
    // logs — the one place issue #93 otherwise keeps them out of.
    if (process.env.NODE_ENV === "development") {
      console.log(`\n[dev] password reset for ${user.email}:\n      ${link}\n`);
    }

    const result = await sendTemplateMail({
      to: user.email,
      key: "core.password-reset",
      values: { display_name: user.display_name || user.email, action_url: link, expiration: `${minutes} minutes` },
    });

    void auditLog({
      siteId,
      action: "auth.password_reset_requested",
      outcome: result.ok ? "success" : "failure",
      actorId: user.id,
      actorEmail: user.email,
      target: user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      detail: result.ok ? "reset link sent" : `reset link could not be mailed: ${result.error}`,
    });
  } catch (err) {
    console.error("Forgot-password processing failed:", err);
  }
}

/** Resolve a raw token to a live reset, or null. Thin re-export for the route. */
export async function resolveResetToken(token: string): Promise<ResolvedReset | null> {
  return findLiveReset(token);
}

/**
 * Set a new password from a validated reset.
 *
 * Marks the token spent, writes the hash, revokes every session (there is no
 * session to keep — the caller is not signed in), clears any sibling reset rows,
 * audits the completion, and mails a confirmation. Never signs the user in.
 */
export async function completePasswordReset(
  reset: ResolvedReset,
  newPassword: string,
  ctx: RequestContext,
): Promise<void> {
  const db = await getDb();
  const rows = await db.query<{ email: string; display_name: string; role: string }>(
    "SELECT email, display_name, role FROM users WHERE id = ? AND site_id = ? LIMIT 1",
    [reset.userId, reset.siteId],
  );
  const user = rows[0];

  // Spend the token before the write, so a crash mid-update cannot leave a
  // redeemable link behind.
  await markResetUsed(reset.id);

  await db.run("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ? AND site_id = ?", [
    await hashPassword(newPassword),
    nowSql(),
    reset.userId,
    reset.siteId,
  ]);

  await revokeUserSessions(reset.userId, reset.siteId);
  await clearUserResets(reset.userId, reset.siteId);

  void auditLog({
    siteId: reset.siteId,
    action: "auth.password_reset",
    actorId: reset.userId,
    actorEmail: user?.email ?? null,
    actorRole: user?.role ?? null,
    target: reset.userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    detail: "completed via emailed link; all sessions revoked",
  });

  if (user?.email) {
    void sendTemplateMail({
      to: user.email,
      key: "core.password-changed",
      values: { display_name: user.email },
    }).catch((err) => console.error("Password-reset confirmation failed:", err));
  }
}

/** Minutes a link stays valid — surfaced to the admin UI copy. */
export { resetTtlMinutes };
