import type { Request, Response } from "express";
import { getDb } from "./db.js";
import { logSafe } from "./log-safe.js";
import { getSession, setSessionCookie, type SessionPayload } from "./session.js";

/**
 * Invalidate every session token already issued for a user.
 *
 * Tokens are stateless, so this counter is the only revocation mechanism. Call
 * it on password change and on an explicit "sign out everywhere". Silently a
 * no-op if 0006_session_revocation has not been applied yet.
 */
export async function revokeUserSessions(userId: string, siteId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.run(
      "UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ? AND site_id = ?",
      [userId, siteId],
    );
  } catch (err) {
    console.error("[justflows] could not revoke sessions for user", logSafe(userId), err);
  }
}

/** Load session from cookie and refresh role/email from the database. */
export async function resolveSession(req: Request, res: Response): Promise<SessionPayload | null> {
  const session = getSession(req);
  if (!session) return null;

  try {
    const db = await getDb();
    type UserRow = { role: string; email: string; token_version?: number | null };

    // 0006_session_revocation adds token_version. If that migration has not run
    // — an upgrade where it failed, or a partially applied schema — the query
    // below errors and the catch would sign every user out. Fall back to the
    // pre-0006 shape instead: revocation is unavailable until the column exists,
    // but the site stays usable.
    let rows: UserRow[];
    try {
      rows = await db.query<UserRow>(
        "SELECT role, email, token_version FROM users WHERE id = ? AND site_id = ? LIMIT 1",
        [session.userId, session.siteId],
      );
    } catch {
      rows = await db.query<UserRow>(
        "SELECT role, email FROM users WHERE id = ? AND site_id = ? LIMIT 1",
        [session.userId, session.siteId],
      );
    }

    const user = rows[0];
    if (!user) return null;

    // The token is self-contained, so this counter is what makes a password
    // change or an explicit "sign out everywhere" take effect. Tokens issued
    // before the column existed carry no tv and are treated as version 0.
    // undefined means the column is absent (see the fallback above); treat that
    // as "revocation not available" rather than as version 0, so an existing
    // token carrying tv: 3 is not rejected while the migration is pending.
    const currentVersion = user.token_version === undefined ? null : Number(user.token_version ?? 0);
    if (currentVersion !== null && Number(session.tv ?? 0) !== currentVersion) return null;

    if (user.role !== session.role || user.email !== session.email) {
      setSessionCookie(res, {
        userId: session.userId,
        siteId: session.siteId,
        role: user.role,
        email: user.email,
        tv: currentVersion ?? session.tv ?? 0,
      });
      return { ...session, role: user.role, email: user.email, tv: currentVersion ?? session.tv ?? 0 };
    }

    return session;
  } catch {
    return null;
  }
}

const PREVIEW_ROLES = new Set(["administrator", "editor"]);

/** Whether ?preview=1 is allowed for the current request (authenticated editor+). */
export async function isPreviewAllowed(req: Request, res: Response): Promise<boolean> {
  if (req.query.preview !== "1") return false;
  const session = await resolveSession(req, res);
  return session !== null && PREVIEW_ROLES.has(session.role);
}
