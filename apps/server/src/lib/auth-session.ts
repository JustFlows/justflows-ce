import type { Request, Response } from "express";
import { getDb } from "./db.js";
import { getSession, setSessionCookie, type SessionPayload } from "./session.js";

/** Load session from cookie and refresh role/email from the database. */
export async function resolveSession(req: Request, res: Response): Promise<SessionPayload | null> {
  const session = getSession(req);
  if (!session) return null;

  try {
    const db = await getDb();
    const rows = await db.query<{ role: string; email: string }>(
      "SELECT role, email FROM users WHERE id = ? AND site_id = ? LIMIT 1",
      [session.userId, session.siteId],
    );
    const user = rows[0];
    if (!user) return null;

    if (user.role !== session.role || user.email !== session.email) {
      setSessionCookie(res, {
        userId: session.userId,
        siteId: session.siteId,
        role: user.role,
        email: user.email,
      });
      return { ...session, role: user.role, email: user.email };
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
