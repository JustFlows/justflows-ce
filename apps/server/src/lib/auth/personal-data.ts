// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import type { PrivacyExportPart, PrivacyProvider, PrivacyRequestContext, PrivacySubject } from "@justflows/sdk";
import { getDb } from "../database/db.js";
import { ensurePluginRuntime, getRuntimeHooks } from "../plugins/plugin-runtime.js";
import { auditLog } from "../security/audit-log.js";
import { getSiteSetting } from "../settings/site-settings.js";

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

/** An account on this site, or a guest known only by an email address. */
export type PersonalDataTarget = { userId: string } | { email: string };

export interface ResolvedSubject extends PrivacySubject {
  account: { id: string; email: string; username: string; displayName: string; role: string } | null;
}

export interface PluginExportPart {
  id: string;
  label: string;
  ok: boolean;
  count: number;
  records: Record<string, unknown>;
  notes: string[];
  error?: string;
}

export interface PersonalDataExport {
  exportedAt: string;
  subject: { userId: string | null; email: string; account: ResolvedSubject["account"] };
  content: Array<Record<string, unknown>>;
  comments: Array<Record<string, unknown>>;
  auditEntries: Array<Record<string, unknown>>;
  /** Every active plugin's part, in the order they answered. */
  plugins: PluginExportPart[];
}

/** Query that tolerates a table this install does not have. */
async function safeQuery<T>(sql: string, params: (string | number)[]): Promise<T[]> {
  try {
    const db = await getDb();
    return await db.query<T>(sql, params);
  } catch {
    // A table may be missing, or a migration may be pending. A partial export
    // is more useful than a failed one, and the gaps are visible in the result.
    return [];
  }
}

/**
 * The account behind a request, by id or by email. An email without an
 * account is a guest: plugins may still hold bookings, orders, or form
 * entries under it.
 */
export async function resolveSubject(siteId: string, target: PersonalDataTarget): Promise<ResolvedSubject | null> {
  const db = await getDb();
  const rows = "userId" in target
    ? await db.query<Record<string, unknown>>("SELECT id, email, username, display_name, role FROM users WHERE id = ? AND site_id = ? LIMIT 1", [target.userId, siteId])
    : await db.query<Record<string, unknown>>("SELECT id, email, username, display_name, role FROM users WHERE LOWER(email) = ? AND site_id = ? LIMIT 1", [target.email.trim().toLowerCase(), siteId]);
  const user = rows[0];
  if (!user) {
    if ("userId" in target) return null;
    return { userId: null, email: target.email.trim().toLowerCase(), account: null };
  }
  const account = { id: String(user.id), email: String(user.email), username: String(user.username), displayName: String(user.display_name), role: String(user.role) };
  return { userId: account.id, email: account.email.toLowerCase(), account };
}

/** Every active plugin's provider for this site. A plugin that answers badly is left out, not trusted. */
async function privacyProviders(context: PrivacyRequestContext): Promise<PrivacyProvider[]> {
  await ensurePluginRuntime();
  const raw = await getRuntimeHooks().applyFilter("privacy.providers", [], context, Object.freeze({ siteId: context.siteId, source: "http", actor: context.actor }));
  const out: PrivacyProvider[] = [];
  for (const item of Array.isArray(raw) ? raw.slice(0, 100) : []) {
    const provider = item as Partial<PrivacyProvider> | null;
    if (provider && typeof provider.id === "string" && typeof provider.label === "string" && typeof provider.export === "function" && typeof provider.erase === "function" && !out.some((existing) => existing.id === provider.id)) {
      out.push(provider as PrivacyProvider);
    }
  }
  return out;
}

const PROVIDER_TIMEOUT_MS = 30_000;

/** Site setting: years financial records are kept by law. The owner sets what applies to them; default 7. */
export const FINANCIAL_RETENTION_SETTING = "privacy_financial_retention_years";
export const DEFAULT_FINANCIAL_RETENTION_YEARS = 7;

export async function financialRetentionYears(siteId: string): Promise<number> {
  const value = await getSiteSetting<unknown>(siteId, FINANCIAL_RETENTION_SETTING).catch(() => null);
  const years = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(years) && years >= 0 && years <= 30 ? years : DEFAULT_FINANCIAL_RETENTION_YEARS;
}

async function requestContext(siteId: string, actor: { userId: string; role: string }): Promise<PrivacyRequestContext> {
  return Object.freeze({
    siteId,
    actor: Object.freeze({ ...actor }),
    requestedAt: new Date().toISOString(),
    retention: Object.freeze({ financialRecordsYears: await financialRetentionYears(siteId) }),
  });
}

/** A plugin's call, bounded in time; its failure is reported, never thrown. */
async function bounded<T>(work: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const value = await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("The plugin did not answer in time.")), PROVIDER_TIMEOUT_MS); })]);
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "The plugin failed." };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function keptOf(value: unknown): PluginErasePart["kept"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((item) => {
    const row = item as Record<string, unknown> | null;
    const until = typeof row?.["until"] === "string" && Number.isFinite(Date.parse(row["until"])) ? new Date(row["until"]).toISOString() : null;
    const count = typeof row?.["count"] === "number" && Number.isFinite(row["count"]) ? Math.max(0, Math.floor(row["count"])) : 0;
    return row && typeof row["kind"] === "string" && until && count > 0 ? [{ kind: row["kind"].slice(0, 60), count, until, reason: typeof row["reason"] === "string" ? row["reason"].slice(0, 300) : "" }] : [];
  });
}

function notesOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((note): note is string => typeof note === "string").map((note) => note.slice(0, 500)).slice(0, 20) : [];
}

/** Everything held about one person on this site, for a subject access request. */
export async function exportPersonalData(
  siteId: string,
  target: PersonalDataTarget,
  actor: { userId: string; role: string },
): Promise<PersonalDataExport | null> {
  const subject = await resolveSubject(siteId, target);
  if (!subject) return null;
  const content = subject.userId
    ? await safeQuery<Record<string, unknown>>("SELECT id, type, title, slug, status, created_at, updated_at FROM content WHERE site_id = ? AND author_id = ?", [siteId, subject.userId])
    : [];
  const comments = await safeQuery<Record<string, unknown>>(
    "SELECT id, content_id, author_name, author_email, body, status, created_at FROM comments WHERE site_id = ? AND LOWER(author_email) = ?",
    [siteId, subject.email],
  );
  const auditEntries = subject.userId
    ? await safeQuery<Record<string, unknown>>("SELECT id, occurred_at, action, outcome, ip, target FROM audit_log WHERE site_id = ? AND actor_id = ?", [siteId, subject.userId])
    : [];

  const context = await requestContext(siteId, actor);
  const request: PrivacySubject = Object.freeze({ userId: subject.userId, email: subject.email });
  const plugins: PluginExportPart[] = [];
  for (const provider of await privacyProviders(context)) {
    const part = await bounded(provider.export(request, context));
    if (part.ok) {
      const value = part.value ?? ({} as PrivacyExportPart);
      const records = value.records && typeof value.records === "object" && !Array.isArray(value.records) ? value.records : {};
      plugins.push({ id: provider.id, label: provider.label, ok: true, count: Number.isFinite(value.count) ? Math.max(0, Math.floor(value.count)) : 0, records, notes: notesOf(value.notes) });
    } else plugins.push({ id: provider.id, label: provider.label, ok: false, count: 0, records: {}, notes: [], error: part.error });
  }

  void auditLog({
    siteId,
    action: "privacy.exported",
    actorId: actor.userId,
    actorRole: actor.role,
    target: subject.userId ?? `guest:${addressReference(subject.email)}`,
    detail: `export: content=${content.length} comments=${comments.length} audit=${auditEntries.length} ${plugins.map((part) => `${part.id}=${part.ok ? part.count : "failed"}`).join(" ")}`.slice(0, 500),
  });

  return {
    exportedAt: new Date().toISOString(),
    subject: { userId: subject.userId, email: subject.email, account: subject.account },
    content,
    comments,
    auditEntries,
    plugins,
  };
}

export interface PluginErasePart {
  id: string;
  label: string;
  ok: boolean;
  counts: Record<string, number>;
  /** Records the law requires, kept until `until` (ISO 8601). */
  kept: Array<{ kind: string; count: number; until: string; reason: string }>;
  notes: string[];
  error?: string;
}

export interface ErasureResult {
  contentReassigned: number;
  commentsAnonymised: number;
  auditEntriesAnonymised: number;
  plugins: PluginErasePart[];
}

/** A stable reference to an address for the audit trail, without the address. */
export function addressReference(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);
}

/**
 * Erase the personal data of one person on this site, in core and in every
 * active plugin.
 *
 * Published content is reassigned rather than deleted: erasure is a right over
 * personal data, not a right to remove a site's articles, and cascading a
 * delete through `content` would take the site down with it. What is removed or
 * anonymised is the identifying material: the comment author, the address in
 * the audit trail, and whatever each plugin holds (each says what it kept).
 *
 * The audit entries themselves are kept with the actor blanked. The record that
 * a role was changed is not personal data about the subject in the same way the
 * IP address is, and destroying the trail on request would make erasure a way
 * to cover tracks. A plugin that fails is reported; the rest still run, and
 * the request can be repeated.
 */
export async function erasePersonalData(
  siteId: string,
  target: PersonalDataTarget,
  reassignContentTo: string | null,
  actor: { userId: string; role: string },
): Promise<ErasureResult | null> {
  const subject = await resolveSubject(siteId, target);
  if (!subject) return null;
  const db = await getDb();
  const result: ErasureResult = { contentReassigned: 0, commentsAnonymised: 0, auditEntriesAnonymised: 0, plugins: [] };

  if (subject.userId) {
    const owned = await safeQuery<{ id: string }>("SELECT id FROM content WHERE site_id = ? AND author_id = ?", [siteId, subject.userId]);
    if (owned.length > 0) {
      await db.run("UPDATE content SET author_id = ? WHERE site_id = ? AND author_id = ?", [reassignContentTo, siteId, subject.userId]).catch(() => undefined);
      result.contentReassigned = owned.length;
    }
  }

  const authored = await safeQuery<{ id: string }>("SELECT id FROM comments WHERE site_id = ? AND LOWER(author_email) = ?", [siteId, subject.email]);
  if (authored.length > 0) {
    for (const comment of authored) {
      await db
        .run(
          "UPDATE comments SET author_name = ?, author_email = ?, author_url = NULL, ip_address = NULL, notify = ?, unsubscribe_token = NULL WHERE site_id = ? AND id = ?",
          ["Deleted user", "", false, siteId, comment.id],
        )
        .catch(() => undefined);
    }
    result.commentsAnonymised = authored.length;
  }

  if (subject.userId) {
    const entries = await safeQuery<{ id: string }>("SELECT id FROM audit_log WHERE site_id = ? AND actor_id = ?", [siteId, subject.userId]);
    if (entries.length > 0) {
      await db.run("UPDATE audit_log SET actor_email = NULL, ip = NULL, user_agent = NULL WHERE site_id = ? AND actor_id = ?", [siteId, subject.userId]).catch(() => undefined);
      result.auditEntriesAnonymised = entries.length;
    }
  }

  const context = await requestContext(siteId, actor);
  const request: PrivacySubject = Object.freeze({ userId: subject.userId, email: subject.email });
  for (const provider of await privacyProviders(context)) {
    const part = await bounded(provider.erase(request, context));
    if (part.ok) {
      const counts: Record<string, number> = {};
      for (const [key, value] of Object.entries(part.value?.counts ?? {}).slice(0, 50)) if (Number.isFinite(value)) counts[key.slice(0, 60)] = Math.max(0, Math.floor(value));
      result.plugins.push({ id: provider.id, label: provider.label, ok: true, counts, kept: keptOf(part.value?.kept), notes: notesOf(part.value?.notes) });
    } else result.plugins.push({ id: provider.id, label: provider.label, ok: false, counts: {}, kept: [], notes: [], error: part.error });
  }

  // The erasure itself is an administrative action and is recorded with the
  // subject's id (a pseudonym) or a hash of a guest's address, never the address.
  void auditLog({
    siteId,
    action: "privacy.erased",
    actorId: actor.userId,
    actorRole: actor.role,
    target: subject.userId ?? `guest:${addressReference(subject.email)}`,
    detail:
      `erasure: content=${result.contentReassigned} comments=${result.commentsAnonymised} audit=${result.auditEntriesAnonymised} ` +
      result.plugins.map((part) => `${part.id}=${part.ok ? Object.values(part.counts).reduce((sum, n) => sum + n, 0) : "failed"}${part.kept.length ? ` kept(${part.kept.map((item) => `${item.kind}:${item.count}<${item.until.slice(0, 10)}`).join(",")})` : ""}`).join(" "),
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
