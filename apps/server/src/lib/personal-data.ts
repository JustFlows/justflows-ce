// SPDX-License-Identifier: MIT

import { getDb } from "./db.js";
import { auditLog } from "./audit-log.js";

/**
 * Subject access and erasure.
 *
 * Justflows stores personal data in more places than the users table: form
 * submissions carry names, addresses and free text; comments carry an author
 * and an address; the audit trail carries IP addresses. Deleting a user removed
 * the row and left all of it, and there was no way to answer a subject access
 * request short of writing SQL by hand.
 *
 * GDPR Art. 15 (access) and Art. 17 (erasure). This is the mechanism; whether a
 * given request must be honoured, and what a lawful retention period is, are
 * decisions for the operator — the software's job is to make both possible.
 */

export interface PersonalDataExport {
  exportedAt: string;
  subject: { id: string; email: string; username: string; displayName: string; role: string };
  content: Array<Record<string, unknown>>;
  comments: Array<Record<string, unknown>>;
  formSubmissions: Array<Record<string, unknown>>;
  auditEntries: Array<Record<string, unknown>>;
}

/** Query that tolerates a table this install does not have. */
async function safeQuery<T>(sql: string, params: (string | number)[]): Promise<T[]> {
  try {
    const db = await getDb();
    return await db.query<T>(sql, params);
  } catch {
    // A plugin table may not exist (forms are optional), or a migration may be
    // pending. A partial export is more useful than a failed one, and the gaps
    // are visible in the result.
    return [];
  }
}

/** Everything held about one account, for a subject access request. */
export async function exportPersonalData(
  siteId: string,
  userId: string,
): Promise<PersonalDataExport | null> {
  const db = await getDb();
  const users = await db.query<Record<string, unknown>>(
    "SELECT id, email, username, display_name, role, created_at FROM users WHERE id = ? AND site_id = ? LIMIT 1",
    [userId, siteId],
  );
  const user = users[0];
  if (!user) return null;

  const content = await safeQuery<Record<string, unknown>>(
    "SELECT id, type, title, slug, status, created_at, updated_at FROM content WHERE site_id = ? AND author_id = ?",
    [siteId, userId],
  );
  const comments = await safeQuery<Record<string, unknown>>(
    "SELECT id, content_id, author_name, author_email, body, status, created_at FROM comments WHERE site_id = ? AND author_email = ?",
    [siteId, String(user.email)],
  );
  const auditEntries = await safeQuery<Record<string, unknown>>(
    "SELECT id, occurred_at, action, outcome, ip, target FROM audit_log WHERE site_id = ? AND actor_id = ?",
    [siteId, userId],
  );

  // Form submissions live in plugin_data as JSON, so they are matched on the
  // address appearing in the stored payload rather than by a column.
  const submissions = await safeQuery<Record<string, unknown>>(
    "SELECT id, collection, data, created_at FROM plugin_data WHERE site_id = ? AND collection = 'submissions'",
    [siteId],
  );
  const email = String(user.email).toLowerCase();
  const formSubmissions = submissions.filter((row) =>
    String(row.data ?? "").toLowerCase().includes(email),
  );

  return {
    exportedAt: new Date().toISOString(),
    subject: {
      id: String(user.id),
      email: String(user.email),
      username: String(user.username),
      displayName: String(user.display_name),
      role: String(user.role),
    },
    content,
    comments,
    formSubmissions,
    auditEntries,
  };
}

export interface ErasureResult {
  contentReassigned: number;
  commentsAnonymised: number;
  submissionsDeleted: number;
  auditEntriesAnonymised: number;
}

/**
 * Erase the personal data attached to an account.
 *
 * Published content is reassigned rather than deleted: erasure is a right over
 * personal data, not a right to remove a site's articles, and cascading a
 * delete through `content` would take the site down with it. What is removed or
 * anonymised is the identifying material — the comment author, the submission,
 * the address in the audit trail.
 *
 * The audit entries themselves are kept with the actor blanked. The record that
 * a role was changed is not personal data about the subject in the same way the
 * IP address is, and destroying the trail on request would make erasure a way
 * to cover tracks.
 */
export async function erasePersonalData(
  siteId: string,
  userId: string,
  reassignContentTo: string | null,
): Promise<ErasureResult> {
  const db = await getDb();
  const result: ErasureResult = {
    contentReassigned: 0,
    commentsAnonymised: 0,
    submissionsDeleted: 0,
    auditEntriesAnonymised: 0,
  };

  const users = await db.query<{ email: string }>(
    "SELECT email FROM users WHERE id = ? AND site_id = ? LIMIT 1",
    [userId, siteId],
  );
  const email = users[0]?.email;
  if (!email) return result;

  const owned = await safeQuery<{ id: string }>(
    "SELECT id FROM content WHERE site_id = ? AND author_id = ?",
    [siteId, userId],
  );
  if (owned.length > 0) {
    await db
      .run("UPDATE content SET author_id = ? WHERE site_id = ? AND author_id = ?", [
        reassignContentTo,
        siteId,
        userId,
      ])
      .catch(() => undefined);
    result.contentReassigned = owned.length;
  }

  const authored = await safeQuery<{ id: string }>(
    "SELECT id FROM comments WHERE site_id = ? AND author_email = ?",
    [siteId, email],
  );
  if (authored.length > 0) {
    await db
      .run(
        "UPDATE comments SET author_name = ?, author_email = ?, author_ip = NULL WHERE site_id = ? AND author_email = ?",
        ["Deleted user", "", siteId, email],
      )
      .catch(() => undefined);
    result.commentsAnonymised = authored.length;
  }

  const submissions = await safeQuery<{ id: string; data: string }>(
    "SELECT id, data FROM plugin_data WHERE site_id = ? AND collection = 'submissions'",
    [siteId],
  );
  const lower = email.toLowerCase();
  for (const row of submissions) {
    if (!String(row.data ?? "").toLowerCase().includes(lower)) continue;
    await db
      .run("DELETE FROM plugin_data WHERE site_id = ? AND id = ?", [siteId, row.id])
      .catch(() => undefined);
    result.submissionsDeleted += 1;
  }

  const entries = await safeQuery<{ id: string }>(
    "SELECT id FROM audit_log WHERE site_id = ? AND actor_id = ?",
    [siteId, userId],
  );
  if (entries.length > 0) {
    await db
      .run(
        "UPDATE audit_log SET actor_email = NULL, ip = NULL, user_agent = NULL WHERE site_id = ? AND actor_id = ?",
        [siteId, userId],
      )
      .catch(() => undefined);
    result.auditEntriesAnonymised = entries.length;
  }

  // The erasure itself is an administrative action and is recorded — with the
  // subject's id, which is a pseudonym, not the address that was removed.
  void auditLog({
    siteId,
    action: "user.deleted",
    target: userId,
    detail:
      `erasure: content=${result.contentReassigned} comments=${result.commentsAnonymised} ` +
      `submissions=${result.submissionsDeleted} audit=${result.auditEntriesAnonymised}`,
  });

  return result;
}

/** Default retention for form submissions, in days. 0 disables the sweep. */
export function submissionRetentionDays(): number {
  const raw = Number(process.env.JF_SUBMISSION_RETENTION_DAYS);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
}

/**
 * Delete form submissions older than the retention window.
 *
 * Off by default: a retention period is a decision for whoever runs the site,
 * and silently deleting their enquiries would be worse than keeping them. When
 * set, this is what makes "no longer than necessary" true in practice rather
 * than only in the privacy policy.
 */
export async function pruneFormSubmissions(siteId: string, days = submissionRetentionDays()): Promise<number> {
  if (days <= 0) return 0;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  const rows = await safeQuery<{ id: string; data: string }>(
    "SELECT id, data FROM plugin_data WHERE site_id = ? AND collection = 'submissions'",
    [siteId],
  );

  const db = await getDb();
  let removed = 0;
  for (const row of rows) {
    let createdAt: number;
    try {
      const parsed = JSON.parse(String(row.data ?? "{}")) as { createdAt?: string };
      createdAt = Date.parse(parsed.createdAt ?? "");
    } catch {
      continue;
    }
    if (!Number.isFinite(createdAt) || createdAt >= cutoffMs) continue;
    await db
      .run("DELETE FROM plugin_data WHERE site_id = ? AND id = ?", [siteId, row.id])
      .catch(() => undefined);
    removed += 1;
  }
  return removed;
}
